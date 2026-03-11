/**
 * Aliyun Function Compute (FC) Deployment Service
 */

import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs/promises';
import { getProjectById } from './project';
import { getPlainServiceToken } from './tokens';
import { timelineLogger } from './timeline';
import { db } from '@/lib/db/client';
import { projectServiceConnections } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import { nanoid } from 'nanoid';

// 并发部署锁：防止同一项目同时部署多次
const deployingProjects = new Set<string>();

interface DeployConfig {
  customDomain?: string;
  region: string;
}

interface PrepareResult {
  packageCount: number;
  message: string;
}

interface DeployResult {
  url: string;
  functionName: string;
  region: string;
}

/**
 * Prepare Linux dependencies for Aliyun FC deployment
 */
export async function prepareAliyunDependencies(
  projectId: string,
  config: DeployConfig
): Promise<PrepareResult> {
  await timelineLogger.logDeploy(projectId, '开始准备阿里云 FC 依赖', 'info', undefined, { region: config.region }, 'prepare_start');

  const project = await getProjectById(projectId);
  if (!project) {
    await timelineLogger.logDeploy(projectId, '项目不存在', 'error', undefined, {}, 'prepare_error');
    throw new Error('Project not found');
  }

  if (project.projectType !== 'python-fastapi') {
    await timelineLogger.logDeploy(projectId, '项目类型不支持', 'error', undefined, { projectType: project.projectType }, 'prepare_error');
    throw new Error('Only python-fastapi projects can be deployed to Aliyun FC');
  }

  if (!project.repoPath) {
    await timelineLogger.logDeploy(projectId, '项目路径不存在', 'error', undefined, {}, 'prepare_error');
    throw new Error('Project path not found');
  }

  const projectPath = project.repoPath;
  const requirementsFile = path.join(projectPath, 'requirements.txt');

  // Check if requirements.txt exists
  try {
    await fs.access(requirementsFile);
  } catch {
    await timelineLogger.logDeploy(projectId, 'requirements.txt 不存在', 'error', undefined, { path: requirementsFile }, 'prepare_error');
    throw new Error('requirements.txt not found in project');
  }

  // Check if dependencies are already installed
  const fcDepsDir = path.join(projectPath, 'fc_deps');
  const depsMarkerFile = path.join(fcDepsDir, '.installed');

  // 计算 requirements.txt 的 hash
  const crypto = await import('crypto');
  const requirementsContent = await fs.readFile(requirementsFile, 'utf-8');
  const requirementsHash = crypto.createHash('md5').update(requirementsContent).digest('hex');

  try {
    const markerContent = await fs.readFile(depsMarkerFile, 'utf-8');
    // 检查 hash 是否匹配
    if (markerContent.includes(requirementsHash)) {
      await timelineLogger.logDeploy(projectId, '依赖已安装，跳过', 'info', undefined, {}, 'prepare_skip');
      return {
        packageCount: 0,
        message: 'Dependencies already installed',
      };
    }
    // hash 不匹配，需要重新安装
    await timelineLogger.logDeploy(projectId, 'requirements.txt 已变更，重新安装依赖', 'info', undefined, {}, 'prepare_reinstall');
  } catch {
    // 标记文件不存在，需要安装
  }

  // Create fc_deps directory
  await fs.mkdir(fcDepsDir, { recursive: true });

  // Install Linux-compatible dependencies to fc_deps directory (isolated from local .venv)
  const PIP_TIMEOUT = 5 * 60 * 1000; // 5 minutes
  return new Promise((resolve, reject) => {
    const args = [
      'install',
      '-i', 'https://mirrors.aliyun.com/pypi/simple/',
      '-r', 'requirements.txt',
      '-t', 'fc_deps',
      '--platform', 'manylinux2014_x86_64',
      '--python-version', '3.12',
      '--only-binary=:all:',
      '--upgrade'
    ];

    console.log(`[Aliyun] Installing dependencies for ${projectId}...`);
    console.log(`[Aliyun] Command: pip ${args.join(' ')}`);
    timelineLogger.logDeploy(projectId, '开始安装 Linux 兼容依赖', 'info', undefined, { command: `pip3 ${args.join(' ')}` }, 'pip_start');

    const pipProcess = spawn('pip3', args, {
      cwd: projectPath,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    let killed = false;

    // 超时控制
    const timeoutId = setTimeout(() => {
      killed = true;
      pipProcess.kill('SIGTERM');
      timelineLogger.logDeploy(projectId, 'pip 安装超时 (5分钟)', 'error', undefined, {}, 'prepare_timeout');
      reject(new Error('pip install timed out after 5 minutes'));
    }, PIP_TIMEOUT);

    pipProcess.stdout.on('data', (data) => {
      stdout += data.toString();
      console.log(`[Aliyun pip] ${data.toString().trim()}`);
    });

    pipProcess.stderr.on('data', (data) => {
      stderr += data.toString();
      console.error(`[Aliyun pip error] ${data.toString().trim()}`);
    });

    pipProcess.on('close', async (code) => {
      clearTimeout(timeoutId);
      if (killed) return; // 已经被超时处理了
      if (code === 0) {
        try {
          // Create marker file with hash
          await fs.writeFile(depsMarkerFile, `${requirementsHash}\n${new Date().toISOString()}`);

          // Count installed packages
          const installedDirs = await fs.readdir(fcDepsDir);
          const packageDirs = installedDirs.filter(name =>
            name.endsWith('.dist-info') || name.endsWith('.egg-info')
          );

          await timelineLogger.logDeploy(projectId, `依赖安装完成，共 ${packageDirs.length} 个包`, 'info', undefined, { packageCount: packageDirs.length }, 'prepare_complete');

          resolve({
            packageCount: packageDirs.length,
            message: 'Dependencies installed successfully',
          });
        } catch (error) {
          await timelineLogger.logDeploy(projectId, '创建标记文件失败', 'error', undefined, { error: String(error) }, 'prepare_error');
          reject(new Error(`Failed to create marker file: ${error}`));
        }
      } else {
        await timelineLogger.logDeploy(projectId, `pip 安装失败，退出码 ${code}`, 'error', undefined, { exitCode: code, stderr }, 'prepare_error');
        reject(new Error(`pip install failed with code ${code}: ${stderr}`));
      }
    });

    pipProcess.on('error', async (error) => {
      clearTimeout(timeoutId);
      if (killed) return;
      await timelineLogger.logDeploy(projectId, `pip 执行失败: ${error.message}`, 'error', undefined, { error: error.message }, 'prepare_error');
      reject(new Error(`Failed to run pip: ${error.message}`));
    });
  });
}

/**
 * Deploy Python FastAPI project to Aliyun FC
 */
export async function deployToAliyunFC(
  projectId: string,
  config: DeployConfig
): Promise<DeployResult> {
  // 检查是否正在部署
  if (deployingProjects.has(projectId)) {
    throw new Error('该项目正在部署中，请稍后再试');
  }
  deployingProjects.add(projectId);

  try {
    return await doDeployToAliyunFC(projectId, config);
  } finally {
    deployingProjects.delete(projectId);
  }
}

async function doDeployToAliyunFC(
  projectId: string,
  config: DeployConfig
): Promise<DeployResult> {
  await timelineLogger.logDeploy(projectId, '开始部署到阿里云函数计算', 'info', undefined, { region: config.region, customDomain: config.customDomain }, 'deploy_start');

  const project = await getProjectById(projectId);
  if (!project) {
    await timelineLogger.logDeploy(projectId, '项目不存在', 'error', undefined, {}, 'deploy_error');
    throw new Error('Project not found');
  }

  if (project.projectType !== 'python-fastapi') {
    await timelineLogger.logDeploy(projectId, '项目类型不支持', 'error', undefined, { projectType: project.projectType }, 'deploy_error');
    throw new Error('Only python-fastapi projects can be deployed to Aliyun FC');
  }

  if (!project.repoPath) {
    await timelineLogger.logDeploy(projectId, '项目路径不存在', 'error', undefined, {}, 'deploy_error');
    throw new Error('Project path not found');
  }

  // Get Aliyun AccessKey
  const aliyunToken = await getPlainServiceToken('aliyun');
  if (!aliyunToken) {
    await timelineLogger.logDeploy(projectId, '阿里云 AccessKey 未配置', 'error', undefined, {}, 'deploy_error');
    throw new Error('Aliyun AccessKey not configured');
  }

  // Parse AccessKey (stored as JSON: {"id": "...", "secret": "..."})
  let accessKeyId: string;
  let accessKeySecret: string;
  try {
    const credentials = JSON.parse(aliyunToken);
    accessKeyId = credentials.id || credentials.accessKeyId;
    accessKeySecret = credentials.secret || credentials.accessKeySecret;
  } catch {
    await timelineLogger.logDeploy(projectId, 'AccessKey 格式无效', 'error', undefined, {}, 'deploy_error');
    throw new Error('Invalid Aliyun AccessKey format. Expected JSON: {"id":"...","secret":"..."}');
  }

  const projectPath = project.repoPath;
  // Function name must match ^[_a-zA-Z][-_a-zA-Z0-9]*$
  let sanitizedName = (project.name || projectId)
    .replace(/\s+/g, '-')  // Replace spaces with hyphens
    .replace(/[^a-zA-Z0-9_-]/g, '');  // Remove invalid characters

  // 确保函数名以字母或下划线开头
  if (!sanitizedName || !/^[_a-zA-Z]/.test(sanitizedName)) {
    sanitizedName = 'app' + sanitizedName;
  }
  const functionName = `${sanitizedName}-${projectId.slice(-8)}`;
  const region = config.region || 'cn-hangzhou';

  await timelineLogger.logDeploy(projectId, '获取阿里云账号信息', 'info', undefined, {}, 'get_account');

  // Get AccountID from AccessKey
  const accountId = await getAccountIdFromAccessKey(accessKeyId, accessKeySecret);

  await timelineLogger.logDeploy(projectId, '生成 FC 适配文件', 'info', undefined, { functionName }, 'generate_files');

  // Generate FC adapter files
  await generateFCAdapterFiles(projectPath, projectId, functionName, config, project.name || projectId);

  await timelineLogger.logDeploy(projectId, '配置 Serverless Devs 凭证', 'info', undefined, {}, 'config_credentials');

  // Configure Serverless Devs credentials
  await configureServerlessDevs(accessKeyId, accessKeySecret, accountId);

  // 如果有自定义域名，先添加DNS记录（必须在 s deploy 之前）
  if (config.customDomain) {
    try {
      await timelineLogger.logDeploy(projectId, '配置自定义域名 CNAME', 'info', undefined, { domain: config.customDomain }, 'cname_start');
      const cnameResult = await addAliyunDnsCname(
        accessKeyId,
        accessKeySecret,
        config.customDomain,
        accountId,
        region
      );
      if (cnameResult.success) {
        await timelineLogger.logDeploy(projectId, 'CNAME 配置成功，等待DNS生效...', 'info', undefined, { domain: config.customDomain }, 'cname_success');
        // 等待几秒让DNS生效
        await new Promise(resolve => setTimeout(resolve, 10000));
      } else {
        await timelineLogger.logDeploy(projectId, `CNAME 配置失败: ${cnameResult.message}`, 'warn', undefined, { domain: config.customDomain, error: cnameResult.message }, 'cname_failed');
      }
    } catch (err) {
      await timelineLogger.logDeploy(projectId, `CNAME 配置异常: ${err}`, 'warn', undefined, { domain: config.customDomain, error: String(err) }, 'cname_error');
    }
  }

  // Deploy using Serverless Devs
  const DEPLOY_TIMEOUT = 5 * 60 * 1000; // 5 minutes
  return new Promise((resolve, reject) => {
    console.log(`[Aliyun] Deploying ${projectId} to FC...`);
    timelineLogger.logDeploy(projectId, '执行 s deploy 命令', 'info', undefined, { region }, 's_deploy_start');

    const deployProcess = spawn('npx', ['@serverless-devs/s', 'deploy', '-y'], {
      cwd: projectPath,
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: true,
      env: {
        ...process.env,
        // 注意：不要设置 FC_REGION，否则会使用内网 OSS endpoint 导致本地超时
      },
    });

    let stdout = '';
    let stderr = '';
    let killed = false;

    // 超时控制
    const timeoutId = setTimeout(() => {
      killed = true;
      deployProcess.kill('SIGTERM');
      timelineLogger.logDeploy(projectId, 's deploy 超时 (5分钟)', 'error', undefined, {}, 'deploy_timeout');
      reject(new Error('s deploy timed out after 5 minutes'));
    }, DEPLOY_TIMEOUT);

    deployProcess.stdout.on('data', (data) => {
      stdout += data.toString();
      console.log(`[Aliyun deploy] ${data.toString().trim()}`);
    });

    deployProcess.stderr.on('data', (data) => {
      stderr += data.toString();
      console.error(`[Aliyun deploy error] ${data.toString().trim()}`);
    });

    deployProcess.on('close', async (code) => {
      clearTimeout(timeoutId);
      if (killed) return; // 已经被超时处理了
      if (code === 0) {
        const url = config.customDomain
          ? `http://${config.customDomain}`
          : extractFCUrl(stdout, region, functionName);

        // 持久化部署结果到数据库
        try {
          await saveDeploymentResult(projectId, {
            url,
            functionName,
            region,
            customDomain: config.customDomain,
          });
        } catch (err) {
          console.error('[Aliyun] Failed to save deployment result:', err);
        }

        await timelineLogger.logDeploy(projectId, `部署成功: ${url}`, 'info', undefined, { url, functionName, region }, 'deploy_success');

        resolve({
          url,
          functionName,
          region,
        });
      } else {
        // 实际错误信息可能在 stdout 里（如 "✖ [xxx] failed to [deploy]"）
        const errorOutput = stdout.includes('failed') ? stdout : stderr;
        await timelineLogger.logDeploy(projectId, `部署失败，退出码 ${code}`, 'error', undefined, { exitCode: code, stdout, stderr }, 'deploy_error');
        reject(new Error(`Deployment failed with code ${code}: ${errorOutput}`));
      }
    });

    deployProcess.on('error', async (error) => {
      clearTimeout(timeoutId);
      if (killed) return;
      await timelineLogger.logDeploy(projectId, `s deploy 执行失败: ${error.message}`, 'error', undefined, { error: error.message }, 'deploy_error');
      reject(new Error(`Failed to run s deploy: ${error.message}`));
    });
  });
}

/**
 * 保存部署结果到数据库
 */
async function saveDeploymentResult(
  projectId: string,
  result: { url: string; functionName: string; region: string; customDomain?: string }
): Promise<void> {
  const now = new Date().toISOString();
  const serviceData = JSON.stringify({
    deployment_url: result.url,
    function_name: result.functionName,
    region: result.region,
    custom_domain: result.customDomain,
    deployed_at: now,
  });

  const existingId = `${projectId}-aliyun-fc`;

  // 检查是否存在
  const existing = await db
    .select()
    .from(projectServiceConnections)
    .where(eq(projectServiceConnections.id, existingId))
    .limit(1);

  if (existing.length > 0) {
    // 更新
    await db
      .update(projectServiceConnections)
      .set({
        serviceData,
        lastSyncAt: now,
        updatedAt: now,
      })
      .where(eq(projectServiceConnections.id, existingId));
  } else {
    // 插入
    await db.insert(projectServiceConnections).values({
      id: existingId,
      projectId,
      provider: 'aliyun-fc',
      status: 'connected',
      serviceData,
      createdAt: now,
      updatedAt: now,
      lastSyncAt: now,
    });
  }
}

/**
 * 添加阿里云 DNS CNAME 记录
 */
async function addAliyunDnsCname(
  accessKeyId: string,
  accessKeySecret: string,
  domain: string,
  accountId: string,
  region: string
): Promise<{ success: boolean; message: string }> {
  const crypto = await import('crypto');
  const https = await import('https');

  // 解析域名
  const domainParts = domain.split('.');
  if (domainParts.length < 2) {
    return { success: false, message: '域名格式无效' };
  }

  // 提取主域名和 RR（记录前缀）
  const mainDomain = domainParts.slice(-2).join('.');
  const rr = domainParts.length > 2 ? domainParts.slice(0, -2).join('.') : '@';

  // FC 触发器域名（必须使用 AccountID）
  const fcDomain = `${accountId}.${region}.fc.aliyuncs.com`;

  const timestamp = new Date().toISOString();
  const nonce = crypto.randomBytes(16).toString('hex');

  const params: Record<string, string> = {
    Action: 'AddDomainRecord',
    DomainName: mainDomain,
    RR: rr,
    Type: 'CNAME',
    Value: fcDomain,
    Format: 'JSON',
    Version: '2015-01-09',
    AccessKeyId: accessKeyId,
    SignatureMethod: 'HMAC-SHA1',
    Timestamp: timestamp,
    SignatureVersion: '1.0',
    SignatureNonce: nonce,
  };

  // Sort parameters
  const sortedKeys = Object.keys(params).sort();
  const canonicalizedQueryString = sortedKeys
    .map(key => `${encodeURIComponent(key)}=${encodeURIComponent(params[key])}`)
    .join('&');

  // Create string to sign
  const stringToSign = `GET&${encodeURIComponent('/')}&${encodeURIComponent(canonicalizedQueryString)}`;

  // Sign
  const hmac = crypto.createHmac('sha1', `${accessKeySecret}&`);
  hmac.update(stringToSign);
  const signature = hmac.digest('base64');

  // Build final URL
  const finalUrl = `https://alidns.aliyuncs.com/?${canonicalizedQueryString}&Signature=${encodeURIComponent(signature)}`;

  return new Promise((resolve) => {
    https.get(finalUrl, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const response = JSON.parse(data);
          if (response.RecordId) {
            resolve({ success: true, message: `CNAME 记录已创建，RecordId: ${response.RecordId}` });
          } else if (response.Code === 'DomainRecordDuplicate') {
            resolve({ success: true, message: 'CNAME 记录已存在' });
          } else {
            resolve({ success: false, message: response.Message || '未知错误' });
          }
        } catch {
          resolve({ success: false, message: `解析响应失败: ${data}` });
        }
      });
    }).on('error', (err) => {
      resolve({ success: false, message: `请求失败: ${err.message}` });
    });
  });
}

/**
 * Generate FC adapter files (index.py, s.yaml)
 */
async function generateFCAdapterFiles(
  projectPath: string,
  projectId: string,
  functionName: string,
  config: DeployConfig,
  projectName: string
): Promise<void> {
  // FC ASGI adapter template (embedded to avoid external file dependency)
  const indexPyTemplate = `# -*- coding: utf-8 -*-
"""
阿里云函数计算 FC 3.0 + FastAPI 适配器
Auto-generated by Genvis
"""
import json
import sys
import os
import asyncio
from io import BytesIO

# Add fc_deps to sys.path for Linux dependencies (isolated from local .venv)
fc_deps_path = os.path.join(os.path.dirname(__file__), 'fc_deps')
if fc_deps_path not in sys.path:
    sys.path.insert(0, fc_deps_path)

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from app.main import app

async def fc_to_asgi(event: dict):
    """将FC事件转换为ASGI请求并调用FastAPI"""
    path = event.get('rawPath', '/')
    method = event.get('requestContext', {}).get('http', {}).get('method', 'GET')
    headers = event.get('headers', {})
    query_params = event.get('queryParameters', {})
    body = event.get('body', '')

    query_string = '&'.join(f"{k}={v}" for k, v in query_params.items()) if query_params else ''

    scope = {
        'type': 'http',
        'asgi': {'version': '3.0'},
        'http_version': '1.1',
        'method': method,
        'path': path,
        'raw_path': path.encode(),
        'query_string': query_string.encode(),
        'root_path': '',
        'headers': [(k.lower().encode(), v.encode()) for k, v in headers.items()],
        'server': ('localhost', 80),
    }

    body_bytes = body.encode() if isinstance(body, str) else body

    response_status = 200
    response_headers = []
    response_body = BytesIO()

    async def receive():
        return {'type': 'http.request', 'body': body_bytes, 'more_body': False}

    async def send(message):
        nonlocal response_status, response_headers
        if message['type'] == 'http.response.start':
            response_status = message['status']
            response_headers = message.get('headers', [])
        elif message['type'] == 'http.response.body':
            response_body.write(message.get('body', b''))

    await app(scope, receive, send)

    headers_dict = {k.decode(): v.decode() for k, v in response_headers}

    # 强制设置inline，防止FC默认的attachment导致下载
    headers_dict['Content-Disposition'] = 'inline'

    return {
        'statusCode': response_status,
        'headers': headers_dict,
        'isBase64Encoded': False,
        'body': response_body.getvalue().decode('utf-8')
    }


def handler(event, context):
    """FC 3.0 HTTP触发器入口"""
    if isinstance(event, bytes):
        event = json.loads(event.decode('utf-8'))

    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
    try:
        return loop.run_until_complete(fc_to_asgi(event))
    finally:
        loop.close()
`;

  await fs.writeFile(path.join(projectPath, 'index.py'), indexPyTemplate);

  // Generate s.yaml
  const sYamlTemplate = `# Serverless Devs 配置文件
edition: 3.0.0
name: ${functionName}-fc
access: default

vars:
  region: "${config.region}"
  service:
    name: genvis-fc-service
    description: 'Genvis AI 生成的应用服务'

resources:
  ${functionName}:
    component: fc3
    props:
      region: \${vars.region}
      functionName: ${functionName}
      description: '${projectName}'
      runtime: python3.12
      cpu: 0.5
      memorySize: 512
      diskSize: 512
      instanceConcurrency: 10
      timeout: 60
      handler: index.handler
      code: ./
      environmentVariables:
        PYTHONPATH: /code
        TZ: Asia/Shanghai
      triggers:
        - triggerName: httpTrigger
          triggerType: http
          triggerConfig:
            authType: anonymous
            methods:
              - GET
              - POST
              - PUT
              - DELETE
              - OPTIONS
            disableURLInternet: false

  custom-domain:
    component: fc3-domain
    props:
      region: \${vars.region}
      domainName: ${config.customDomain || 'auto'}
      protocol: HTTP
      routeConfig:
        routes:
          - functionName: ${functionName}
            methods:
              - GET
              - POST
              - PUT
              - DELETE
              - OPTIONS
            path: /*
            qualifier: LATEST
`;

  await fs.writeFile(path.join(projectPath, 's.yaml'), sYamlTemplate);

  // Create .s_ignore file
  const sIgnore = `node_modules/
.venv/
__pycache__/
*.pyc
.git/
.DS_Store
.env
.next/
dist/
build/`;

  await fs.writeFile(path.join(projectPath, '.s_ignore'), sIgnore);
}

/**
 * Configure Serverless Devs credentials
 */
async function configureServerlessDevs(accessKeyId: string, accessKeySecret: string, accountId: string): Promise<void> {
  const configDir = path.join(process.env.HOME || process.env.USERPROFILE || '', '.s');
  await fs.mkdir(configDir, { recursive: true });

  // Write YAML format configuration
  const yamlConfig = `default:
  AccountID: "${accountId}"
  AccessKeyID: ${accessKeyId}
  AccessKeySecret: ${accessKeySecret}
`;

  await fs.writeFile(
    path.join(configDir, 'access.yaml'),
    yamlConfig
  );
}

/**
 * Get AccountID from AccessKey using STS GetCallerIdentity API
 */
async function getAccountIdFromAccessKey(accessKeyId: string, accessKeySecret: string): Promise<string> {
  // Use STS GetCallerIdentity to get account information
  const crypto = await import('crypto');
  const https = await import('https');

  const timestamp = new Date().toISOString();
  const nonce = crypto.randomBytes(16).toString('hex');

  const params: Record<string, string> = {
    Action: 'GetCallerIdentity',
    Format: 'JSON',
    Version: '2015-04-01',
    AccessKeyId: accessKeyId,
    SignatureMethod: 'HMAC-SHA1',
    Timestamp: timestamp,
    SignatureVersion: '1.0',
    SignatureNonce: nonce,
  };

  // Sort parameters
  const sortedKeys = Object.keys(params).sort();
  const canonicalizedQueryString = sortedKeys
    .map(key => `${encodeURIComponent(key)}=${encodeURIComponent(params[key])}`)
    .join('&');

  // Create string to sign
  const stringToSign = `GET&${encodeURIComponent('/')}&${encodeURIComponent(canonicalizedQueryString)}`;

  // Sign
  const hmac = crypto.createHmac('sha1', `${accessKeySecret}&`);
  hmac.update(stringToSign);
  const signature = hmac.digest('base64');

  // Build final URL
  const finalUrl = `https://sts.aliyuncs.com/?${canonicalizedQueryString}&Signature=${encodeURIComponent(signature)}`;

  return new Promise((resolve, reject) => {
    https.get(finalUrl, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const response = JSON.parse(data);
          if (response.AccountId) {
            resolve(response.AccountId);
          } else {
            reject(new Error(`Failed to get AccountID: ${data}`));
          }
        } catch (err) {
          reject(new Error(`Failed to parse STS response: ${data}`));
        }
      });
    }).on('error', reject);
  });
}


/**
 * Extract FC URL from deploy output
 */
function extractFCUrl(output: string, region: string, functionName: string): string {
  // 优先提取 fcapp.run 域名（可直接 Web 访问）
  const fcappMatch = output.match(/https?:\/\/[a-zA-Z0-9-]+\.[a-zA-Z0-9-]+\.fcapp\.run/i);
  if (fcappMatch) {
    return fcappMatch[0];
  }

  // 尝试提取 system_url
  const systemUrlMatch = output.match(/system_url:\s*(https?:\/\/[^\s]+)/i);
  if (systemUrlMatch) {
    return systemUrlMatch[1];
  }

  // 尝试提取 url: 字段
  const urlMatch = output.match(/url:\s*(https?:\/\/[^\s]+)/i);
  if (urlMatch) {
    return urlMatch[1];
  }

  // Fallback: 构造默认 FC URL（注意：此 URL 无法直接 Web 访问）
  return `https://${functionName}.${region}.fc.aliyuncs.com`;
}
