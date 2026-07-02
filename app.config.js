export default {
  expo: {
    name: 'lpg-go',
    slug: 'lpg-go',
    owner: 'dtan25',
    version: '1.0.0',
    scheme: 'lpg-go',
    web: { bundler: 'metro' },
    ios: {
      bundleIdentifier: 'com.iscalestudio.lpggo',
      config: { googleMapsApiKey: process.env.EXPO_PUBLIC_GOOGLE_MAPS_KEY }
    },
    android: {
      package: 'com.iscalestudio.lpggo',
      config: { googleMaps: { apiKey: process.env.EXPO_PUBLIC_GOOGLE_MAPS_KEY } }
    },
    plugins: [
      'expo-router',
      ['expo-location', {
        locationWhenInUsePermission: 'LPG Go needs your location to share it with the customer during delivery.'
      }],
      'expo-notifications',
    ],
    extra: {
      eas: {
        projectId: '561fa033-aa41-477a-9e42-88d23c44049b',
      },
    },
  },
};