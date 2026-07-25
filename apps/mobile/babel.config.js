module.exports = function (api) {
  api.cache(true)
  return {
    // babel-preset-expo (SDK 54) auto-configures expo-router and the
    // react-native-worklets plugin (required by reanimated 4) — no manual
    // plugins needed anymore.
    presets: ['babel-preset-expo'],
  }
}
