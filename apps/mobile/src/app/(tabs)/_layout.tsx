import { Ionicons } from '@expo/vector-icons';
import { Tabs } from 'expo-router/js-tabs';
import type { IconName } from '../../components/ui';
import { useColors } from '../../lib/theme';

const TABS: [name: string, title: string, icon: IconName][] = [
  ['index', 'Home', 'home-outline'],
  ['bookings', 'Bookings', 'list-outline'],
  ['activities', 'Follow-ups', 'checkmark-done-outline'],
  ['diary', 'Diary', 'calendar-outline'],
  ['more', 'More', 'person-circle-outline'],
];

export default function TabLayout() {
  const c = useColors();
  return (
    <Tabs screenOptions={{
      tabBarActiveTintColor: c.accent, tabBarInactiveTintColor: c.muted,
      tabBarStyle: { backgroundColor: c.surface, borderTopColor: c.border },
      headerStyle: { backgroundColor: c.surface }, headerTintColor: c.text, headerShadowVisible: false,
    }}>
      {TABS.map(([name, title, icon]) => (
        <Tabs.Screen key={name} name={name} options={{
          title, headerShown: name !== 'index',
          tabBarIcon: ({ color, size }) => <Ionicons name={icon} color={color} size={size} />,
        }} />
      ))}
    </Tabs>
  );
}
