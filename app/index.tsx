import { ActivityIndicator, View } from 'react-native';

// Root layout handles all auth routing — this screen is a fallback.
export default function Index() {
  return (
    <View className="flex-1 items-center justify-center bg-white">
      <ActivityIndicator size="large" color="#F97316" />
    </View>
  );
}
