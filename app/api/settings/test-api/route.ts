/**
 * API Test Route
 * POST /api/settings/test-api - Test Claude API or Aliyun AccessKey connection
 */

import { NextRequest, NextResponse } from 'next/server';
import crypto from 'crypto';

interface TestApiRequest {
  cliId: string;
  apiKey: string;
  apiUrl?: string;
  // For Aliyun
  accessKeyId?: string;
  accessKeySecret?: string;
}

/**
 * Verify Aliyun AccessKey using STS GetCallerIdentity
 */
async function verifyAliyunAccessKey(accessKeyId: string, accessKeySecret: string): Promise<{ success: boolean; message: string; accountId?: string }> {
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

  try {
    const response = await fetch(finalUrl);
    const data = await response.json();

    if (data.AccountId) {
      return {
        success: true,
        message: `验证成功，账号ID: ${data.AccountId}`,
        accountId: data.AccountId,
      };
    } else if (data.Code) {
      // Aliyun error response
      let errorMessage = data.Message || data.Code;
      if (data.Code === 'InvalidAccessKeyId.NotFound') {
        errorMessage = 'AccessKeyId 不存在';
      } else if (data.Code === 'SignatureDoesNotMatch') {
        errorMessage = 'AccessKeySecret 错误';
      }
      return { success: false, message: errorMessage };
    } else {
      return { success: false, message: '未知响应' };
    }
  } catch (error) {
    return {
      success: false,
      message: `网络错误: ${error instanceof Error ? error.message : '未知错误'}`,
    };
  }
}

/**
 * POST /api/settings/test-api
 * Test Claude API or Aliyun AccessKey connection with provided credentials
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as TestApiRequest;
    const { cliId, apiKey, apiUrl, accessKeyId, accessKeySecret } = body;

    // Handle Aliyun AccessKey verification
    if (cliId === 'aliyun') {
      if (!accessKeyId || !accessKeySecret) {
        return NextResponse.json(
          {
            success: false,
            message: 'AccessKeyId 和 AccessKeySecret 都是必填项',
          },
          { status: 400 }
        );
      }

      const result = await verifyAliyunAccessKey(accessKeyId, accessKeySecret);
      return NextResponse.json(result, { status: result.success ? 200 : 400 });
    }

    // Only support Claude for now
    if (cliId !== 'claude') {
      return NextResponse.json(
        {
          success: false,
          message: `API testing is not supported for ${cliId}`,
        },
        { status: 400 }
      );
    }

    if (!apiKey) {
      return NextResponse.json(
        {
          success: false,
          message: 'API Key is required',
        },
        { status: 400 }
      );
    }

    // Test the Claude API
    const baseUrl = apiUrl || 'https://api.100agent.co';
    const testUrl = `${baseUrl}/v1/messages`;

    const testResponse = await fetch(testUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-5-20250929',
        max_tokens: 1,
        messages: [
          {
            role: 'user',
            content: 'hi',
          },
        ],
      }),
    });

    if (testResponse.ok) {
      return NextResponse.json({
        success: true,
        message: 'API connection successful',
      });
    } else {
      // Handle specific error cases
      let errorMessage = 'API connection failed';

      if (testResponse.status === 401) {
        errorMessage = 'Invalid API Key';
      } else if (testResponse.status === 403) {
        errorMessage = 'API Key does not have permission';
      } else if (testResponse.status === 429) {
        errorMessage = 'Rate limit exceeded';
      } else {
        // Try to parse error response
        try {
          const responseText = await testResponse.text();
          try {
            const responseData = JSON.parse(responseText);
            if (responseData?.error?.message) {
              errorMessage = responseData.error.message;
            }
          } catch {
            // If not JSON, use text response
            if (responseText && responseText.length < 200) {
              errorMessage = responseText;
            }
          }
        } catch {
          // Ignore text parsing errors
        }
      }

      return NextResponse.json(
        {
          success: false,
          message: errorMessage,
        },
        { status: testResponse.status }
      );
    }
  } catch (error) {
    console.error('[API] Failed to test API:', error);

    let errorMessage = 'Network error or invalid API endpoint';
    if (error instanceof Error) {
      if (error.message.includes('fetch')) {
        errorMessage = 'Cannot connect to API endpoint';
      } else {
        errorMessage = error.message;
      }
    }

    return NextResponse.json(
      {
        success: false,
        message: errorMessage,
      },
      { status: 500 }
    );
  }
}

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
