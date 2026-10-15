import { Ionicons } from '@expo/vector-icons';
import { Tabs } from 'expo-router/js-tabs';
import type { IconName } from '../../components/ui';
import { View } from 'react-native';
import { Brand, TopButtons } from '../../components/topbar';
import { useColors } from '../../lib/theme';
import { t } from '../../i18n';

const TABS: [name: string, title: string, icon: IconName][] = [
  ['index', 'Home', 'home-outline'],
  ['bookings', 'Contracts', 'document-text-outline'],
  ['activities', 'Follow-ups', 'checkmark-done-outline'],
  ['diary', 'Calendar', 'calendar-outline'],
  ['more', 'More', 'person-circle-outline'],
];

export default function TabLayout() {
  const c = useColors();
  return (
    // No bottom bar: Home, ☰ Menu and EN | AR sit in the header of every screen (approved mock-up).
    <Tabs screenOptions={{
      tabBarStyle: { display: 'none' },
      headerStyle: { backgroundColor: c.surface }, headerTintColor: c.text, headerShadowVisible: false,
      headerTitle: () => <Brand />, headerTitleAlign: 'left', headerRight: () => <View style={{ marginRight: 12 }}><TopButtons /></View>,
    }}>
      {TABS.map(([name, title, icon]) => (
        <Tabs.Screen key={name} name={name} options={{
          title: t(title),
          tabBarIcon: ({ color, size }) => <Ionicons name={icon} color={color} size={size} />,
        }} />
      ))}
    </Tabs>
  );
}
