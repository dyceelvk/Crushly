import { Platform } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import * as Location from 'expo-location';

export type PickedImage = { uri: string; mimeType: string };

const MAX_EDGE = 1440;

/**
 * Picks (or captures) a photo and downsizes it before upload: faster uploads on
 * mobile data, less storage, quicker loads for everyone who views it.
 */
export async function pickImage({ camera = false, square = false }: { camera?: boolean; square?: boolean } = {}): Promise<
  PickedImage | { error: string } | null
> {
  try {
    if (camera && Platform.OS !== 'web') {
      const perm = await ImagePicker.requestCameraPermissionsAsync();
      if (!perm.granted) return { error: 'Camera access is off. You can turn it on in your device settings.' };
    } else if (Platform.OS !== 'web') {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) return { error: 'Photo access is off. You can turn it on in your device settings.' };
    }
    const options: ImagePicker.ImagePickerOptions = {
      mediaTypes: ['images'],
      allowsEditing: Platform.OS !== 'web',
      aspect: square ? [1, 1] : [4, 5],
      quality: 0.9,
      cameraType: ImagePicker.CameraType.front,
    };
    const result = camera && Platform.OS !== 'web' ? await ImagePicker.launchCameraAsync(options) : await ImagePicker.launchImageLibraryAsync(options);
    if (result.canceled || !result.assets?.length) return null;
    const asset = result.assets[0];
    const longest = Math.max(asset.width || 0, asset.height || 0);
    if (longest > MAX_EDGE || Platform.OS !== 'web') {
      const resize = (asset.width || 0) >= (asset.height || 0) ? { width: Math.min(asset.width || MAX_EDGE, MAX_EDGE) } : { height: Math.min(asset.height || MAX_EDGE, MAX_EDGE) };
      const out = await manipulateAsync(asset.uri, longest > MAX_EDGE ? [{ resize }] : [], { compress: 0.82, format: SaveFormat.JPEG });
      return { uri: out.uri, mimeType: 'image/jpeg' };
    }
    return { uri: asset.uri, mimeType: asset.mimeType || 'image/jpeg' };
  } catch (e) {
    return { error: (e as Error).message || 'We couldn’t open your photos.' };
  }
}

/**
 * Asks for *approximate* location only, rounds it to ~1 km on the device,
 * and the server snaps it to its own grid and never reveals it — members only ever see a rounded distance.
 */
export async function getApproximateLocation(): Promise<{ lat: number; lng: number; city?: string } | { error: string }> {
  try {
    const perm = await Location.requestForegroundPermissionsAsync();
    if (!perm.granted) return { error: 'Location is off. You can still add your city by hand.' };
    const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Low });
    let city: string | undefined;
    if (Platform.OS !== 'web') {
      try {
        const [place] = await Location.reverseGeocodeAsync({ latitude: pos.coords.latitude, longitude: pos.coords.longitude });
        city = [place?.district || place?.subregion, place?.city].filter(Boolean).join(', ') || undefined;
      } catch {
        /* city stays manual */
      }
    }
    const round = (n: number) => Math.round(n * 100) / 100; // ≈1.1 km — the precise fix never leaves the phone
    return { lat: round(pos.coords.latitude), lng: round(pos.coords.longitude), city };
  } catch {
    return { error: 'We couldn’t get your location. You can add your city by hand.' };
  }
}
