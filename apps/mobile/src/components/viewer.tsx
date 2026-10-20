import { Ionicons } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Image, Modal, Pressable, ScrollView, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { api, getServer } from '../lib/api';
import { useColors } from '../lib/theme';
import { t } from '../i18n';
import { ErrorText, T } from './ui';

export type ViewTarget = { kind: 'document' | 'file'; id: string };

interface Opened { title: string; pages: number; token: string }

/** A4 portrait until the real size of the page is known. */
const A4 = 1 / Math.SQRT2;

/** One page image, as wide as the screen and as tall as its own proportions. */
function Page({ uri, width, label }: { uri: string; width: number; label: string }) {
  const [ratio, setRatio] = useState(A4);
  const [loading, setLoading] = useState(true);
  useEffect(() => { Image.getSize(uri, (w, h) => h && setRatio(w / h), () => undefined); }, [uri]);
  return (
    <View style={{ width, aspectRatio: ratio, backgroundColor: '#fff' }}>
      <Image source={{ uri }} style={{ width: '100%', height: '100%' }} resizeMode="contain" accessibilityLabel={label}
        onLoadEnd={() => setLoading(false)} />
      {loading && <ActivityIndicator style={{ position: 'absolute', top: '45%', alignSelf: 'center' }} />}
    </View>
  );
}

/**
 * The watermarked document viewer, as on the web (customer comment 7): pages drawn by the
 * server with the viewer's name, employee ID and the time across them. There is no file to
 * save or share; people with the download right still open the file itself.
 */
export function DocumentViewer({ target, onClose }: { target: ViewTarget; onClose: () => void }) {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const [doc, setDoc] = useState<Opened | null>(null);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    api<Opened>(`/viewer/${target.kind}/${target.id}`).then(setDoc, setError);
  }, [target.kind, target.id]);

  const pageWidth = Math.min(width - 24, 900);
  return (
    <Modal visible animationType="slide" onRequestClose={onClose} presentationStyle="fullScreen">
      <View style={{ flex: 1, backgroundColor: '#1c1c1c', paddingTop: insets.top }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingVertical: 10, backgroundColor: c.surface }}>
          <View style={{ flex: 1 }}>
            <T bold numberOfLines={1}>{doc?.title ?? t('Loading…')}</T>
            {doc && <T small muted>{t('{n} pages', { n: doc.pages })}</T>}
          </View>
          <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel={t('Close')} hitSlop={10}>
            <Ionicons name="close" size={26} color={c.text} />
          </Pressable>
        </View>
        <View style={{ paddingHorizontal: 14, paddingVertical: 6, backgroundColor: c.surface2 }}>
          <T small muted>{t('View only: your name is shown on every page. Downloading is not allowed for your account.')}</T>
        </View>
        {!!error && <View style={{ padding: 14 }}><ErrorText error={error} /></View>}
        {/* Pinch to zoom on iPhone; Android scrolls. */}
        <ScrollView maximumZoomScale={3} minimumZoomScale={1} contentContainerStyle={{ alignItems: 'center', gap: 14, padding: 12, paddingBottom: insets.bottom + 24 }}>
          {!doc && !error && <ActivityIndicator color="#fff" style={{ marginTop: 40 }} />}
          {doc && Array.from({ length: doc.pages }, (_, i) => (
            <Page key={i} width={pageWidth} label={t('Page {n}', { n: i + 1 })}
              uri={`${getServer()}/api/viewer/page?t=${encodeURIComponent(doc.token)}&n=${i + 1}`} />
          ))}
        </ScrollView>
      </View>
    </Modal>
  );
}
