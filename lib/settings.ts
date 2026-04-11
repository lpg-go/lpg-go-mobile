import supabase from './supabase';

export async function fetchAppLogoUrl(): Promise<string | null> {
  const { data } = await supabase
    .from('platform_settings')
    .select('app_logo_url')
    .eq('id', 1)
    .single();
  return data?.app_logo_url ?? null;
}
