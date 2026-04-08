import { useEffect, useState } from 'react';

import supabase from './supabase';

// Module-level cache: undefined = not yet fetched, null = fetched but no URL
let cachedUrl: string | null | undefined = undefined;

export function useAppLogo() {
  const [logoUrl, setLogoUrl] = useState<string | null>(
    cachedUrl !== undefined ? cachedUrl : null
  );
  const [loading, setLoading] = useState(cachedUrl === undefined);

  useEffect(() => {
    if (cachedUrl !== undefined) return;

    supabase
      .from('platform_settings')
      .select('app_logo_url')
      .eq('id', 1)
      .single()
      .then(({ data }) => {
        cachedUrl = data?.app_logo_url ?? null;
        setLogoUrl(cachedUrl);
        setLoading(false);
      });
  }, []);

  return { logoUrl, loading };
}
