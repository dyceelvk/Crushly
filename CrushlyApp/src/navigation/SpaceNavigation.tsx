import React from 'react';
import { Pressable, View, useWindowDimensions } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Txt } from '../components/Txt';
import { useSwipeTabs } from '../components/SwipeTabs';
import { useTheme } from '../theme/ThemeProvider';
import { haptic } from '../lib/haptics';
import type { RootStackParamList } from './types';

/** The ordinary app destinations, available while reading a Space. */
export function SpaceNavigation() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const swipe = useSwipeTabs({
    options: ['Home', 'Connections', 'Whispers', 'Space'] as const,
    value: 'Space', width,
    onChange: (next) => {
      if (next === 'Whispers') navigation.navigate('Main', { screen: 'Messages' });
      else if (next === 'Connections') navigation.navigate('Main', { screen: 'Connections', params: {tab: 'connections'} });
      else if (next === 'Home') navigation.navigate('Main', { screen: 'Flows', params: {tab: 'crushes'} });
    },
  });
  const actions: {label: string; icon: keyof typeof Ionicons.glyphMap; onPress: () => void}[] = [
    { label: 'Home', icon: 'home-outline', onPress: () => navigation.navigate('Main', {screen:'Flows',params:{tab:'crushes'}}) },
    { label: 'Connections', icon: 'people-outline', onPress: () => navigation.navigate('Main', {screen:'Connections',params:{tab:'connections'}}) },
    { label: 'Create post', icon: 'add-circle', onPress: () => navigation.navigate('CreatePost') },
    { label: 'Whispers', icon: 'chatbubble-ellipses-outline', onPress: () => navigation.navigate('Main', {screen:'Messages'}) },
    { label: 'Notifications', icon: 'notifications-outline', onPress: () => navigation.navigate('Notifications') },
  ];
  return <View {...swipe.panHandlers} accessibilityRole="tablist" style={{ flexDirection:'row', paddingTop:8, paddingBottom:Math.max(insets.bottom, 10), borderTopWidth:1, borderTopColor:colors.border, backgroundColor:colors.bgSecondary }}>
    {actions.map(item => <Pressable key={item.label} accessibilityRole="button" accessibilityLabel={item.label} onPress={() => {haptic.tap(); item.onPress();}} style={{flex:1, minHeight:50, alignItems:'center', justifyContent:'center', gap:3}}>
      <Ionicons name={item.icon} size={24} color={item.label === 'Create post' ? colors.primary : colors.textMuted}/>
      <Txt variant="caption" color="textMuted" style={{fontSize:10}} maxFontSizeMultiplier={1.1} numberOfLines={1}>{item.label === 'Create post' ? 'Create' : item.label}</Txt>
    </Pressable>)}
  </View>;
}
