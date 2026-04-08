import { router } from 'expo-router';
import { useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import supabase from '../../lib/supabase';

type Role = 'customer' | 'provider';
type ProviderType = 'dealer' | 'rider';

export default function CompleteProfileScreen() {
  const [fullName, setFullName] = useState('');
  const [role, setRole] = useState<Role | null>(null);
  const [providerType, setProviderType] = useState<ProviderType | null>(null);
  const [businessName, setBusinessName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit() {
    setError('');

    if (!fullName.trim()) {
      setError('Full name is required.');
      return;
    }
    if (!role) {
      setError('Please select your role.');
      return;
    }
    if (role === 'provider' && !providerType) {
      setError('Please select dealer or rider.');
      return;
    }
    if (role === 'provider' && providerType === 'dealer' && !businessName.trim()) {
      setError('Business name is required for dealers.');
      return;
    }

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      setError('Not authenticated.');
      return;
    }

    setLoading(true);

    const profileData: Record<string, unknown> = {
      id: user.id,
      full_name: fullName.trim(),
      role,
      updated_at: new Date().toISOString(),
    };

    if (role === 'provider') {
      profileData.provider_type = providerType;
      if (providerType === 'dealer') {
        profileData.business_name = businessName.trim();
      }
    }

    const { error: upsertError } = await supabase
      .from('profiles')
      .upsert(profileData);

    setLoading(false);

    if (upsertError) {
      setError(upsertError.message);
      return;
    }

    if (role === 'customer') router.replace('/(customer)');
    else router.replace('/(provider)');
  }

  return (
    <SafeAreaView className="flex-1 bg-white">
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        className="flex-1"
      >
      <ScrollView
        contentContainerClassName="flex-grow justify-center px-6 py-10"
        keyboardShouldPersistTaps="handled"
      >
        <Text className="mb-2 text-3xl font-bold text-gray-900">Complete your profile</Text>
        <Text className="mb-8 text-base text-gray-500">Tell us a bit about yourself.</Text>

        {/* Full name */}
        <Text className="mb-2 text-sm font-medium text-gray-700">Full name</Text>
        <TextInput
          className="mb-6 rounded-xl border border-gray-300 px-4 py-3 text-base text-gray-900"
          placeholder="Juan dela Cruz"
          placeholderTextColor="#9CA3AF"
          value={fullName}
          onChangeText={setFullName}
          autoCapitalize="words"
        />

        {/* Role selection */}
        <Text className="mb-3 text-sm font-medium text-gray-700">I am...</Text>
        <View className="mb-6 gap-3">
          <RoleOption
            label="I want to order LPG"
            selected={role === 'customer'}
            onPress={() => {
              setRole('customer');
              setProviderType(null);
            }}
          />
          <RoleOption
            label="I am a dealer / rider"
            selected={role === 'provider'}
            onPress={() => setRole('provider')}
          />
        </View>

        {/* Provider sub-options */}
        {role === 'provider' && (
          <>
            <Text className="mb-3 text-sm font-medium text-gray-700">Provider type</Text>
            <View className="mb-6 gap-3">
              <RoleOption
                label="Dealer"
                selected={providerType === 'dealer'}
                onPress={() => setProviderType('dealer')}
              />
              <RoleOption
                label="Rider"
                selected={providerType === 'rider'}
                onPress={() => {
                  setProviderType('rider');
                  setBusinessName('');
                }}
              />
            </View>

            {providerType === 'dealer' && (
              <>
                <Text className="mb-2 text-sm font-medium text-gray-700">Business name</Text>
                <TextInput
                  className="mb-6 rounded-xl border border-gray-300 px-4 py-3 text-base text-gray-900"
                  placeholder="Dela Cruz LPG"
                  placeholderTextColor="#9CA3AF"
                  value={businessName}
                  onChangeText={setBusinessName}
                  autoCapitalize="words"
                />
              </>
            )}
          </>
        )}

        {error ? (
          <Text className="mb-4 text-sm text-red-500">{error}</Text>
        ) : null}

        <TouchableOpacity
          className="items-center rounded-xl bg-primary py-4"
          onPress={handleSubmit}
          disabled={loading}
        >
          {loading ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text className="text-base font-semibold text-white">Continue</Text>
          )}
        </TouchableOpacity>

        <TouchableOpacity
          className="mt-3 items-center py-3"
          onPress={() => supabase.auth.signOut()}
          disabled={loading}
        >
          <Text className="text-sm text-gray-400">Sign out</Text>
        </TouchableOpacity>
      </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function RoleOption({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity
      onPress={onPress}
      className={`rounded-xl border-2 px-4 py-4 ${
        selected ? 'border-primary bg-orange-50' : 'border-gray-200 bg-white'
      }`}
    >
      <Text
        className={`text-base font-medium ${selected ? 'text-primary' : 'text-gray-700'}`}
      >
        {label}
      </Text>
    </TouchableOpacity>
  );
}
