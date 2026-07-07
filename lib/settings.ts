import supabase from './supabase';

// Whether providers must upload (and have approved) a DTI/SEC/license document
// before entering the app. Fails safe to `true` (document required) if the
// setting can't be read, so a fetch error never lets providers skip the gate.
export async function fetchProviderDocRequired(): Promise<boolean> {
  const { data } = await supabase
    .from('platform_settings')
    .select('require_provider_document')
    .eq('id', 1)
    .single();
  return data?.require_provider_document ?? true;
}
