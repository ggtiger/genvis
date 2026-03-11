/** @type {import('next').NextConfig} */
// 让 ws 模块跳过加载 bufferutil 原生绑定，使用纯 JS 回退
// 避免 Next.js webpack 打包后 bufferUtil.mask is not a function 错误
process.env.WS_NO_BUFFER_UTIL = '1';

const path = require('path');

const projectsDirRaw = process.env.PROJECTS_DIR || './data/projects';
const projectsDirAbsolute = path.isAbsolute(projectsDirRaw)
  ? path.resolve(projectsDirRaw)
  : path.resolve(process.cwd(), projectsDirRaw);
const nextConfig = {
  output: 'standalone',
  outputFileTracingRoot: path.join(__dirname),
  reactStrictMode: true,
  // Allow images from resources folder
  images: {
    unoptimized: false,
    remotePatterns: [],
  },
  async rewrites() {
    return [
      {
        source: '/resources/:path*',
        destination: '/api/resources/:path*',
      },
    ];
  },
  typescript: {
    ignoreBuildErrors: false,
  },
  eslint: {
    ignoreDuringBuilds: true,
  },
  productionBrowserSourceMaps: false,
  // Disable critters optimizeCss to avoid missing module during build
  experimental: {
    instrumentationHook: true,
    optimizeCss: false,
    scrollRestoration: true,
    // Externalize native/heavy packages to skip webpack compilation on each request
    serverExternalPackages: ['better-sqlite3', 'dingtalk-stream-sdk-nodejs', 'ws', 'bufferutil', 'utf-8-validate'],
    outputFileTracingIncludes: {
      '/api/**': ['./node_modules/node-pty/**/*'],
    },
    // Exclude unnecessary files from standalone output to reduce bundle size
    outputFileTracingExcludes: {
      '/api/**': [
        // Exclude user project data
        './data/projects/**',
        './data/user-skills/**',
        // Exclude multi-platform prebuilds (only include current platform)
        './node_modules/node-pty/prebuilds/win32-*/**',
        './node_modules/node-pty/prebuilds/linux-*/**',
        // Exclude unnecessary dev dependencies
        './node_modules/typescript/**',
        './node_modules/@types/**',
        './node_modules/eslint/**',
        './node_modules/prettier/**',
        './node_modules/.bin/**',
        // Exclude test and build files
        '**/*.test.{js,ts}',
        '**/*.spec.{js,ts}',
        '**/test/**',
        '**/tests/**',
        '**/__tests__/**',
        // Exclude documentation
        '**/*.md',
        '**/*.txt',
        '!README.md',
        // Exclude git files
        '**/.git/**',
        '**/.github/**',
      ],
      '*': [
        // Global exclusions for all routes
        './data/projects/**',
        './data/user-skills/**',
        './data/data/**',
        './data/secretary-uploads/**',
        './data/logs/**',
        './data/*.db',
        './data/*.db-*',
        './skills/**',
        './node_modules/node-pty/prebuilds/win32-*/**',
        './node_modules/node-pty/prebuilds/linux-*/**',
        './node_modules/typescript/**',
        './node_modules/@types/**',
        './node_modules/eslint/**',
        './node_modules/prettier/**',
      ],
    },
  },
  // Reduce logging noise
  logging: {
    fetches: {
      fullUrl: false,
    },
  },
  // Inject project root path as environment variable
  env: {
    NEXT_PUBLIC_PROJECT_ROOT: process.cwd(),
    NEXT_PUBLIC_PROJECTS_DIR_ABSOLUTE: projectsDirAbsolute,
    // 让 ws 模块跳过加载 bufferutil 原生绑定，使用纯 JS 回退
    // 避免 webpack 打包后 bufferUtil.mask is not a function 错误
    WS_NO_BUFFER_UTIL: '1',
  },
  // Add webpack configuration to handle server-side code properly
  webpack: (config, { isServer, dev }) => {
    // Use memory cache for faster builds
    if (dev) {
      config.cache = {
        type: 'memory',
      };

      // Exclude sub-project directories from hot reload monitoring
      // to prevent platform restart when editing sub-project files
      config.watchOptions = {
        ...config.watchOptions,
        ignored: [
          '**/node_modules/**',
          '**/.next/**',
          '**/.git/**',
          '**/data/projects/**',  // Exclude user sub-projects
        ],
      };
    }

    if (isServer) {
      // Mark native modules as externals to prevent webpack from bundling them
      config.externals = config.externals || [];
      config.externals.push('node-pty');
      config.externals.push('better-sqlite3');
    }

    if (!isServer) {
      // Exclude server-only modules from client bundle
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false,
        path: false,
        os: false,
      };
    }
    return config;
  },
};

module.exports = nextConfig;
