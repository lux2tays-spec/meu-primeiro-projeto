const { getDefaultConfig } = require('expo/metro-config')
const path = require('path')

const projectRoot = __dirname
const monorepoRoot = path.resolve(projectRoot, '../..')

const config = getDefaultConfig(projectRoot)

config.watchFolders = [...new Set([...(config.watchFolders ?? []), monorepoRoot])]

config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(monorepoRoot, 'node_modules'),
]

// npm workspaces installs multiple copies of react and react-native:
//   apps/mobile/node_modules/react@18.2.0      ← canonical (project version)
//   node_modules/react@18.3.1                  ← hoisted monorepo copy
//   node_modules/expo/node_modules/react@19.2.6 ← pulled in by @expo/vector-icons
//   node_modules/expo/node_modules/react-native@0.85.3 ← same cause
//
// Two React instances in one bundle → "Invalid hook call / useId of null".
// Fix: after Metro resolves a module, if the file path points to any copy of
// react or react-native other than the project's canonical one, redirect it.

// Resolve the canonical copies dynamically from the mobile app's own
// dependency tree (react 19 / react-native 0.81), regardless of where npm
// physically placed them (hoisted at the monorepo root or nested here).
const CANONICAL_REACT =
  path.dirname(require.resolve('react/package.json', { paths: [projectRoot] })) + path.sep
const CANONICAL_RN =
  path.dirname(require.resolve('react-native/package.json', { paths: [projectRoot] })) + path.sep

function maybeRedirect(filePath) {
  // react-native check must come first (its path contains "react-native" not just "react")
  if (filePath.includes(`${path.sep}node_modules${path.sep}react-native${path.sep}`)) {
    if (!filePath.startsWith(CANONICAL_RN)) {
      const suffix = filePath.split(`${path.sep}node_modules${path.sep}react-native${path.sep}`).pop()
      return CANONICAL_RN + suffix
    }
  } else if (filePath.includes(`${path.sep}node_modules${path.sep}react${path.sep}`)) {
    if (!filePath.startsWith(CANONICAL_REACT)) {
      const suffix = filePath.split(`${path.sep}node_modules${path.sep}react${path.sep}`).pop()
      return CANONICAL_REACT + suffix
    }
  }
  return null
}

// tsconfig.json maps "react" → "@types/react" so TypeScript uses the React 19
// types (the hoisted @types/react at the monorepo root is v18, pulled in by the
// Next.js apps). Metro also honors tsconfig paths (needed for "@/*"), so we
// must short-circuit those type-only mappings here and resolve the real
// runtime packages instead.
const RUNTIME_OVERRIDES = {}
for (const name of ['react', 'react/jsx-runtime', 'react/jsx-dev-runtime']) {
  RUNTIME_OVERRIDES[name] = require.resolve(name, { paths: [projectRoot] })
}

const originalResolveRequest = config.resolver.resolveRequest
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (RUNTIME_OVERRIDES[moduleName]) {
    return { type: 'sourceFile', filePath: RUNTIME_OVERRIDES[moduleName] }
  }
  const resolve = originalResolveRequest || context.resolveRequest
  const result = resolve(context, moduleName, platform)
  if (result?.filePath) {
    const redirected = maybeRedirect(result.filePath)
    if (redirected) return { ...result, filePath: redirected }
  }
  return result
}

module.exports = config
