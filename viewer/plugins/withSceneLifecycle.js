// iOS 27 stops apps at launch unless they adopt the UIScene life cycle, and the SDK 57 native
// template doesn't yet. Expo already ships the scene delegate (ExpoAppSceneDelegate); this plugin
// registers it in Info.plist and lets it start React Native instead of the app delegate.
const { withAppDelegate, withInfoPlist } = require('expo/config-plugins');

module.exports = function withSceneLifecycle(config) {
  config = withInfoPlist(config, (c) => {
    c.modResults.UIApplicationSceneManifest = {
      UIApplicationSupportsMultipleScenes: false,
      UISceneConfigurations: {
        UIWindowSceneSessionRoleApplication: [
          { UISceneConfigurationName: 'Default Configuration', UISceneDelegateClassName: 'EXExpoAppSceneDelegate' },
        ],
      },
    };
    return c;
  });
  return withAppDelegate(config, (c) => {
    let src = c.modResults.contents;
    src = src.replace(
      /class AppDelegate: ExpoAppDelegate \{/,
      'class AppDelegate: ExpoAppDelegate, ExpoReactNativeFactoryProvider {'
    );
    // The scene delegate creates the window and starts React Native in it
    src = src.replace(/\n#if os\(iOS\) \|\| os\(tvOS\)\n\s*window = UIWindow\(frame: UIScreen\.main\.bounds\)[\s\S]*?#endif\n/, '\n');
    if (!src.includes('ExpoReactNativeFactoryProvider {') || src.includes('UIScreen.main.bounds')) {
      throw new Error('withSceneLifecycle: AppDelegate.swift no longer matches the expected template');
    }
    c.modResults.contents = src;
    return c;
  });
};
