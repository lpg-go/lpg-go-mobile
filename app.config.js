export default {
  expo: {
    name: 'lpg-go',
    slug: 'lpg-go',
    version: '1.0.0',
    scheme: 'lpg-go',
    web: { bundler: 'metro' },
    ios: {
      config: { googleMapsApiKey: process.env.EXPO_PUBLIC_GOOGLE_MAPS_KEY }
    },
    android: {
      config: { googleMaps: { apiKey: process.env.EXPO_PUBLIC_GOOGLE_MAPS_KEY } }
    },
    plugins: [
      'expo-router',
      ['expo-location', {
        locationWhenInUsePermission: 'LPG Go needs your location to share it with the customer during delivery.'
      }]
    ]
  }
};
