import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useColorScheme } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { Loading, Screen } from '../components/ui';
import { AuthProvider, useAuth } from '../lib/auth';
import { useColors } from '../lib/theme';

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: 1, staleTime: 15_000 } } });

export default function RootLayout() {
  const scheme = useColorScheme();
  return (
    <QueryClientProvider client={queryClient}>
      <SafeAreaProvider>
        <ThemeProvider value={scheme === 'dark' ? DarkTheme : DefaultTheme}>
          <AuthProvider>
            <StatusBar style="auto" />
            <RootStack />
          </AuthProvider>
        </ThemeProvider>
      </SafeAreaProvider>
    </QueryClientProvider>
  );
}

function RootStack() {
  const { ready, me } = useAuth();
  const c = useColors();
  if (!ready) return <Screen><Loading /></Screen>;
  return (
    <Stack screenOptions={{
      headerStyle: { backgroundColor: c.surface }, headerTintColor: c.text, headerShadowVisible: false,
      contentStyle: { backgroundColor: c.bg }, headerBackTitle: 'Back',
    }}>
      {/* Signed-in screens; everything else falls back to the sign-in screen. */}
      <Stack.Protected guard={Boolean(me)}>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="booking/[id]" options={{ title: 'Booking' }} />
        <Stack.Screen name="booking/new" options={{ title: 'New enquiry', presentation: 'modal' }} />
        <Stack.Screen name="notifications" options={{ title: 'Notifications' }} />
      </Stack.Protected>
      <Stack.Protected guard={!me}>
        <Stack.Screen name="login" options={{ headerShown: false }} />
      </Stack.Protected>
    </Stack>
  );
}
