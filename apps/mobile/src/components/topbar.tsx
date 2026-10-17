import { Ionicons } from '@expo/vector-icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { router, usePathname } from 'expo-router';
import { useState } from 'react';
import { Alert, Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { api, type Me } from '../lib/api';
import { applyUserSettings, useAuth } from '../lib/auth';
import { useColors } from '../lib/theme';
import { LANGUAGES, lang, t } from '../i18n';
import { MODULES, openModule, ordered } from './modules';
import { T } from './ui';

/** Name card under the name: job title and employee ID (customer request). */
export const nameCard = (me: { job_title?: string | null; employee_no?: string | null } | null | undefined) =>
  [me?.job_title?.toUpperCase(), me?.employee_no].filter(Boolean).join(' - ');

/** Company logo and name, at the start of every header. */
export function Brand() {
  const { me } = useAuth();
  const c = useColors();
  return (
    <Pressable onPress={() => router.navigate('/')} accessibilityRole="link" style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
      <View style={{ width: 28, height: 28, borderRadius: 8, backgroundColor: c.brand, alignItems: 'center', justifyContent: 'center' }}>
        <Text style={{ color: '#fff', fontWeight: '800', fontSize: 11 }}>{(me?.tenant.name ?? 'SE').slice(0, 2).toUpperCase()}</Text>
      </View>
      <Text numberOfLines={1} style={{ color: c.text, fontWeight: '700', fontSize: 15, maxWidth: 130 }}>{me?.tenant.name}</Text>
    </Pressable>
  );
}

/** Home · ☰ Menu · EN | AR, on every screen (customer request). */
export function TopButtons() {
  const c = useColors();
  const path = usePathname();
  const [open, setOpen] = useState(false);
  const bell = useQuery({ queryKey: ['notifications'], queryFn: () => api<{ unread: number }>('/notifications'), refetchInterval: 60_000 });
  const btn = { width: 36, height: 36, borderRadius: 10, borderWidth: 1, borderColor: c.borderStrong, backgroundColor: c.surface, alignItems: 'center' as const, justifyContent: 'center' as const };
  return (
    <View style={{ flexDirection: 'row', gap: 6, alignItems: 'center' }}>
      <Pressable style={btn} onPress={() => router.navigate('/')} accessibilityLabel={t('Home')} hitSlop={4}>
        <Ionicons name="home-outline" size={19} color={path === '/' ? c.accent : c.text} />
      </Pressable>
      <Pressable style={btn} onPress={() => setOpen(true)} accessibilityLabel={t('Menu')} hitSlop={4}>
        <Ionicons name="menu" size={21} color={c.text} />
        {(bell.data?.unread ?? 0) > 0 && <View style={{ position: 'absolute', top: 6, right: 6, width: 8, height: 8, borderRadius: 4, backgroundColor: '#ff3b30' }} />}
      </Pressable>
      <LanguageToggle />
      <MenuSheet visible={open} onClose={() => setOpen(false)} unread={bell.data?.unread ?? 0} />
    </View>
  );
}

/** EN | AR: switches straight away; on phones Arabic needs one restart for right-to-left. */
export function LanguageToggle() {
  const { me } = useAuth();
  const qc = useQueryClient();
  const c = useColors();
  const current = lang().code;
  const choose = async (code: string) => {
    if (!me || code === current) return;
    const next = { ...me, preferences: { ...(me.preferences ?? {}), locale: code } } as Me;
    qc.setQueryData(['me'], next);
    if (applyUserSettings(next)) Alert.alert(t('Restart the app'), t('Close and reopen the app to switch the layout direction.'));
    api('/me/preferences', { method: 'PATCH', body: { locale: code } }).catch(() => undefined);
  };
  return (
    <View style={{ flexDirection: 'row', borderWidth: 1, borderColor: c.borderStrong, borderRadius: 10, overflow: 'hidden', height: 36 }}>
      {LANGUAGES.map((l) => (
        <Pressable key={l.code} onPress={() => choose(l.code)} accessibilityRole="button" accessibilityState={{ selected: current === l.code }}
          style={{ paddingHorizontal: 9, justifyContent: 'center', backgroundColor: current === l.code ? c.accent : c.surface }}>
          <Text style={{ fontWeight: '700', fontSize: 12, color: current === l.code ? c.onAccent : c.text2 }}>{l.code.toUpperCase()}</Text>
        </Pressable>
      ))}
    </View>
  );
}

function MenuSheet({ visible, onClose, unread }: { visible: boolean; onClose: () => void; unread: number }) {
  const { me, can, signOut } = useAuth();
  const c = useColors();
  const insets = useSafeAreaInsets();
  const modules = ordered(me?.tenant.home_order).filter((m) => m.area === 'all' || can(m.area as 'sell' | 'finance' | 'manage'));
  const live = modules.filter((m) => m.route || m.web);
  const planned = modules.filter((m) => !m.route && !m.web);
  const go = (fn: () => void) => { onClose(); setTimeout(fn, 50); };
  const Row = ({ icon, color, label, onPress, right, danger }: { icon: React.ComponentProps<typeof Ionicons>['name']; color: string; label: string; onPress: () => void; right?: React.ReactNode; danger?: boolean }) => (
    <Pressable onPress={onPress} accessibilityRole="button" style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 9, paddingHorizontal: 10, borderRadius: 10, backgroundColor: pressed ? c.surface2 : 'transparent' })}>
      <View style={{ width: 28, height: 28, borderRadius: 8, backgroundColor: color, alignItems: 'center', justifyContent: 'center' }}>
        <Ionicons name={icon} size={16} color={color === '#ffffff' ? '#e5383b' : '#fff'} />
      </View>
      <Text style={{ flex: 1, color: danger ? c.danger : c.text, fontSize: 15 }}>{label}</Text>
      {right}
    </Pressable>
  );
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={{ flex: 1, flexDirection: 'row' }}>
        <Pressable style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.35)' }} onPress={onClose} accessibilityLabel={t('Close')} />
        <View style={{ width: '80%', maxWidth: 360, backgroundColor: c.surface, paddingTop: insets.top + 10, paddingBottom: insets.bottom + 10 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingBottom: 12, borderBottomWidth: 1, borderColor: c.border }}>
            <View style={{ width: 38, height: 38, borderRadius: 19, backgroundColor: c.accentSoft, alignItems: 'center', justifyContent: 'center' }}>
              <T bold style={{ color: c.accent }}>{(me?.code ?? me?.name ?? '?').slice(0, 3)}</T>
            </View>
            <View style={{ flex: 1 }}>
              <T bold>{me?.name}</T>
              {!!nameCard(me) && <T small muted>{nameCard(me)}</T>}
            </View>
            <Pressable onPress={onClose} accessibilityLabel={t('Close')} hitSlop={10}><Ionicons name="close" size={24} color={c.text} /></Pressable>
          </View>
          <ScrollView contentContainerStyle={{ padding: 8, gap: 2 }}>
            <Row icon="home" color="#2563eb" label={t('Home')} onPress={() => go(() => router.navigate('/'))} />
            {live.map((m) => <Row key={m.key} icon={m.icon} color={m.color} label={t(m.label)} onPress={() => go(() => openModule(m))} />)}
            <Row icon="notifications" color="#f59e0b" label={t('Notifications')} onPress={() => go(() => router.push('/notifications'))}
              right={unread > 0 ? <View style={{ minWidth: 20, height: 20, borderRadius: 10, backgroundColor: '#ff3b30', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 5 }}><Text style={{ color: '#fff', fontSize: 11, fontWeight: '700' }}>{unread}</Text></View> : undefined} />
            {planned.length > 0 && (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 10 }}>
                <View style={{ width: 28, height: 28, borderRadius: 8, backgroundColor: '#cbd5e1', alignItems: 'center', justifyContent: 'center' }}><Ionicons name="time-outline" size={16} color="#fff" /></View>
                <T small muted style={{ flex: 1 }}>{planned.map((m) => t(m.label)).join(' · ')} — {t('Soon')}</T>
              </View>
            )}
          </ScrollView>
          <View style={{ borderTopWidth: 1, borderColor: c.border, padding: 8 }}>
            <Row icon="person-circle" color="#64748b" label={t('Preferences & cover')} onPress={() => go(() => router.push('/more'))} />
            <Row icon="log-out-outline" color={c.danger} label={t('Sign out')} danger onPress={() => go(() => signOut())} />
          </View>
        </View>
      </View>
    </Modal>
  );
}

export { MODULES };
