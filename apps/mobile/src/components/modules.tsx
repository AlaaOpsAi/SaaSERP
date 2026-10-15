import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { Alert, Linking, Pressable, Text, View } from 'react-native';
import { getServer } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useColors } from '../lib/theme';
import { intlLocale, t } from '../i18n';
import type { IconName } from './ui';

/**
 * The ERP modules as iPhone-style icons, in the company's order (set by an admin in
 * the web app). Same list as the web home screen; modules without a phone screen
 * open the web app, planned ones say "coming soon".
 */
export type Area = 'all' | 'sell' | 'finance' | 'manage';
export interface Module { key: string; label: string; icon: IconName; color: string; area: Area; route?: string; web?: string }

export const MODULES: Module[] = [
  { key: 'dashboard', label: 'Dashboard', icon: 'bar-chart', color: '#2563eb', area: 'all', web: '/dashboard' },
  { key: 'contracts', label: 'Contracts', icon: 'document-text', color: '#f97316', area: 'all', route: '/bookings' },
  { key: 'calendar', label: 'Event calendar', icon: 'calendar', color: '#ffffff', area: 'all', route: '/diary' },
  { key: 'activities', label: 'Activities', icon: 'alarm', color: '#10b981', area: 'all', route: '/activities' },
  { key: 'crm', label: 'CRM', icon: 'people', color: '#0e9aa7', area: 'all', web: '/clients' },
  { key: 'operations', label: 'Operations', icon: 'restaurant', color: '#64748b', area: 'manage' },
  { key: 'finance', label: 'Finance', icon: 'cash', color: '#16a34a', area: 'finance', web: '/finance' },
  { key: 'inventory', label: 'Inventory', icon: 'cube', color: '#d97706', area: 'manage' },
  { key: 'admin', label: 'Admin & IT', icon: 'settings', color: '#6b7280', area: 'manage', web: '/settings' },
  { key: 'marketing', label: 'Marketing', icon: 'megaphone', color: '#db2777', area: 'manage' },
  { key: 'procurement', label: 'Procurement', icon: 'cart', color: '#4f46e5', area: 'manage' },
  { key: 'hr', label: 'HR', icon: 'id-card', color: '#0284c7', area: 'manage' },
];

export function ordered(order: string[] | null | undefined) {
  if (!order?.length) return MODULES;
  const byKey = new Map(MODULES.map((m) => [m.key, m]));
  return [...order.map((k) => byKey.get(k)).filter((m): m is Module => Boolean(m)), ...MODULES.filter((m) => !order.includes(m.key))];
}

/** Open a module: its phone screen, the web app, or a "coming soon" note. */
export function openModule(m: Module) {
  if (m.route) router.push(m.route as never);
  else if (m.web) Linking.openURL(`${getServer()}${m.web}`);
  else Alert.alert(t(m.label), t('{name} is planned in a later phase. It will open here once it is built.', { name: t(m.label) }));
}

export function ModuleGrid({ badges = {} }: { badges?: Record<string, number | undefined> }) {
  const { me, can } = useAuth();
  const c = useColors();
  const list = ordered(me?.tenant.home_order).filter((m) => m.area === 'all' || can(m.area as 'sell' | 'finance' | 'manage'));
  const open = openModule;
  const now = new Date();
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', rowGap: 16 }}>
      {list.map((m) => {
        const planned = !m.route && !m.web;
        const badge = badges[m.key];
        return (
          <Pressable key={m.key} onPress={() => open(m)} accessibilityRole="button"
            accessibilityLabel={planned ? `${t(m.label)} · ${t('Coming soon')}` : t(m.label)}
            style={({ pressed }) => ({ width: '25%', alignItems: 'center', gap: 6, opacity: pressed ? 0.7 : 1 })}>
            <View style={{
              width: 60, height: 60, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: m.color,
              opacity: planned ? 0.45 : 1, shadowColor: '#000', shadowOpacity: 0.15, shadowRadius: 6, shadowOffset: { width: 0, height: 3 }, elevation: 3,
              borderWidth: m.key === 'calendar' ? 1 : 0, borderColor: 'rgba(0,0,0,0.08)',
            }}>
              {m.key === 'calendar' ? (
                <View style={{ alignItems: 'center' }}>
                  <Text style={{ color: '#e5383b', fontSize: 10, fontWeight: '700', textTransform: 'uppercase' }}>
                    {now.toLocaleDateString(intlLocale(), { weekday: 'short' })}
                  </Text>
                  <Text style={{ color: '#111', fontSize: 26, fontWeight: '300', lineHeight: 30 }}>{now.getDate()}</Text>
                </View>
              ) : <Ionicons name={m.icon} size={30} color="#fff" />}
              {!!badge && (
                <View style={{ position: 'absolute', top: -6, right: -6, minWidth: 20, height: 20, borderRadius: 10, paddingHorizontal: 5,
                  backgroundColor: '#ff3b30', alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: c.bg }}>
                  <Text style={{ color: '#fff', fontSize: 11, fontWeight: '700' }}>{badge > 99 ? '99+' : badge}</Text>
                </View>
              )}
            </View>
            <Text numberOfLines={2} style={{ color: planned ? c.muted : c.text, fontSize: 11.5, textAlign: 'center', paddingHorizontal: 2 }}>
              {t(m.label)}{planned ? `\n${t('Soon')}` : ''}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
