import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Image,
  ScrollView,
  TextInput,
  FlatList,
  Dimensions,
  StatusBar,
  SafeAreaView,
} from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import Svg, { Path, Defs, LinearGradient, Stop, Circle } from 'react-native-svg';
import Icon from 'react-native-vector-icons/Ionicons';

const { width } = Dimensions.get('window');

// ====================== THEME ======================
const colors = {
  background: '#000000',
  surface: '#121212',
  surfaceElevated: '#1A1A1A',
  primary: '#FF2D55',
  primarySoft: '#FF4D6D',
  gold: '#D4AF37',
  goldSoft: '#E8C547',
  text: '#FFFFFF',
  textSecondary: '#AAAAAA',
  textMuted: '#777777',
  online: '#4CD964',
  border: '#2A2A2A',
};

// ====================== LOGO COMPONENT ======================
const CrushlyLogo = ({ size = 120, showText = true }: { size?: number; showText?: boolean }) => (
  <View style={{ alignItems: 'center' }}>
    <Svg width={size} height={size} viewBox="0 0 200 200">
      <Defs>
        <LinearGradient id="goldGrad" x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0%" stopColor="#F5D76E" />
          <Stop offset="50%" stopColor="#D4AF37" />
          <Stop offset="100%" stopColor="#B8860B" />
        </LinearGradient>
      </Defs>

      {/* Outer glow circle */}
      <Circle cx="100" cy="100" r="90" fill="none" stroke="url(#goldGrad)" strokeWidth="2" opacity="0.3" />

      {/* Stylized C */}
      <Path
        d="M140 55
           C110 40, 60 45, 50 85
           C40 125, 70 160, 110 160
           C130 160, 145 150, 150 140"
        fill="none"
        stroke="url(#goldGrad)"
        strokeWidth="14"
        strokeLinecap="round"
      />

      {/* Connection curve / heart flourish */}
      <Path
        d="M55 110
           Q80 95, 100 110
           Q120 125, 145 110"
        fill="none"
        stroke="url(#goldGrad)"
        strokeWidth="8"
        strokeLinecap="round"
        opacity="0.9"
      />
    </Svg>

    {showText && (
      <Text style={{
        color: colors.gold,
        fontSize: size * 0.28,
        fontWeight: '700',
        marginTop: 8,
        letterSpacing: 1,
      }}>
        Crushly
      </Text>
    )}
  </View>
);

// ====================== REUSABLE COMPONENTS ======================
const PrimaryButton = ({ title, onPress, gold = false, outline = false }: any) => (
  <TouchableOpacity
    style={[
      styles.btn,
      gold && styles.btnGold,
      outline && styles.btnOutline,
    ]}
    onPress={onPress}
    activeOpacity={0.85}
  >
    <Text style={[styles.btnText, outline && { color: colors.text }]}>
      {title}
    </Text>
  </TouchableOpacity>
);

const Chip = ({ label, selected, onPress }: any) => (
  <TouchableOpacity
    style={[styles.chip, selected && styles.chipSelected]}
    onPress={onPress}
  >
    <Text style={[styles.chipText, selected && styles.chipTextSelected]}>
      {label}
    </Text>
  </TouchableOpacity>
);

// ====================== SCREENS ======================

// 1. Splash
const SplashScreen = ({ navigation }: any) => {
  useEffect(() => {
    const t = setTimeout(() => navigation.replace('OnboardingWelcome'), 2500);
    return () => clearTimeout(t);
  }, []);

  return (
    <View style={styles.center}>
      <CrushlyLogo size={140} />
      <Text style={styles.tagline}>Find your connection.</Text>
    </View>
  );
};

// 2. Onboarding Welcome
const OnboardingWelcome = ({ navigation }: any) => (
  <View style={styles.container}>
    <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
      <Image
        source={{ uri: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=600' }}
        style={{ width: width * 0.85, height: width * 0.9, borderRadius: 24 }}
      />
      <Text style={styles.welcomeTitle}>Welcome to Crushly</Text>
      <Text style={styles.welcomeSub}>Meet men. Make connections.{'\n'}Follow the feeling.</Text>
    </View>
    <PrimaryButton title="Get Started" onPress={() => navigation.navigate('LookingFor')} gold />
    <TouchableOpacity onPress={() => navigation.navigate('MainTabs')}>
      <Text style={styles.link}>I already have an account</Text>
    </TouchableOpacity>
  </View>
);

// 3. Looking For
const LookingForScreen = ({ navigation }: any) => {
  const [selected, setSelected] = useState(['Dating', 'New connections']);
  const options = ['Dating', 'Relationship', 'Friends', 'Something casual', 'New connections', 'Not sure yet'];

  const toggle = (item: string) => {
    setSelected(prev =>
      prev.includes(item) ? prev.filter(i => i !== item) : [...prev, item]
    );
  };

  return (
    <SafeAreaView style={styles.container}>
      <Text style={styles.screenTitle}>What are you looking for?</Text>
      <Text style={styles.screenSub}>You can select multiple options.</Text>

      <View style={{ marginTop: 30, gap: 12 }}>
        {options.map(opt => (
          <Chip
            key={opt}
            label={opt}
            selected={selected.includes(opt)}
            onPress={() => toggle(opt)}
          />
        ))}
      </View>

      <View style={{ flex: 1 }} />
      <PrimaryButton title="Next" onPress={() => navigation.navigate('ProfileSetup')} gold />
    </SafeAreaView>
  );
};

// 4. Profile Setup
const ProfileSetupScreen = ({ navigation }: any) => (
  <ScrollView style={styles.container} contentContainerStyle={{ paddingBottom: 40 }}>
    <Text style={styles.screenTitle}>Create your profile</Text>
    <Text style={styles.screenSub}>3/5</Text>

    <View style={styles.photoGrid}>
      <View style={styles.photoPlaceholder}>
        <Icon name="camera" size={32} color={colors.textMuted} />
        <Text style={{ color: colors.textMuted, marginTop: 6 }}>Show your world.</Text>
        <Text style={{ color: colors.textMuted, fontSize: 12 }}>Add at least 4 photos.</Text>
      </View>
    </View>

    <TextInput style={styles.input} placeholder="Name" placeholderTextColor={colors.textMuted} />
    <TextInput style={styles.input} placeholder="Age" placeholderTextColor={colors.textMuted} keyboardType="numeric" />
    <TextInput style={styles.input} placeholder="Location" placeholderTextColor={colors.textMuted} />
    <TextInput
      style={[styles.input, { height: 100, textAlignVertical: 'top' }]}
      placeholder="Bio - Tell people about yourself..."
      placeholderTextColor={colors.textMuted}
      multiline
    />

    <PrimaryButton title="Next" onPress={() => navigation.navigate('MainTabs')} gold />
  </ScrollView>
);

// 5. Discover
const DiscoverScreen = ({ navigation }: any) => (
  <SafeAreaView style={styles.container}>
    <Text style={styles.header}>Discover</Text>
    <Text style={styles.headerSub}>Find someone worth knowing.</Text>

    <View style={styles.card}>
      <Image
        source={{ uri: 'https://images.unsplash.com/photo-1506794778202-cad84cf45f1d?w=600' }}
        style={styles.cardImage}
      />
      <View style={styles.cardInfo}>
        <Text style={styles.cardName}>Daniel, 24  <Text style={{ color: colors.online }}>●</Text></Text>
        <Text style={styles.cardBio}>Good vibes, great energy, looking for something real.</Text>
        <View style={styles.tags}>
          {['Music', 'Fitness', 'Travel'].map(t => (
            <View key={t} style={styles.tag}><Text style={styles.tagText}>{t}</Text></View>
          ))}
        </View>
      </View>

      <View style={styles.actions}>
        <TouchableOpacity style={styles.circleBtn}>
          <Icon name="close" size={28} color="#fff" />
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.circleBtn, styles.crushBtn]}
          onPress={() => navigation.navigate('MutualCrush')}
        >
          <Icon name="heart" size={30} color="#fff" />
        </TouchableOpacity>
        <TouchableOpacity style={styles.circleBtn}>
          <Icon name="person-add" size={26} color="#fff" />
        </TouchableOpacity>
      </View>
    </View>
  </SafeAreaView>
);

// 6. Mutual Crush
const MutualCrushScreen = ({ navigation }: any) => (
  <View style={styles.center}>
    <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 30 }}>
      <Image source={{ uri: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=200' }} style={styles.avatarLarge} />
      <View style={styles.heartCircle}>
        <Text style={{ fontSize: 28 }}>❤️</Text>
      </View>
      <Image source={{ uri: 'https://images.unsplash.com/photo-1506794778202-cad84cf45f1d?w=200' }} style={styles.avatarLarge} />
    </View>

    <Text style={styles.bigTitle}>It's a Crush.</Text>
    <Text style={styles.bigSub}>You both felt something.</Text>

    <PrimaryButton title="Say hello" onPress={() => navigation.navigate('Chat')} />
    <View style={{ height: 16 }} />
    <PrimaryButton title="Keep discovering" onPress={() => navigation.goBack()} outline />
  </View>
);

// 7. Crushes
const CrushesScreen = () => {
  const data = [
    { name: 'Jayden, 23', time: 'Crushed on you · 2h ago' },
    { name: 'Marcus, 26', time: 'Crushed on you · 5h ago' },
    { name: 'Tomi, 22', time: 'Crushed on you · 1d ago' },
    { name: 'Kelechi, 25', time: 'Crushed on you · 1d ago' },
    { name: 'Ryan, 24', time: 'Crushed on you · 2d ago' },
  ];

  return (
    <SafeAreaView style={styles.container}>
      <Text style={styles.header}>Your Crushes</Text>
      <View style={styles.statsRow}>
        <Text style={styles.stat}>Crushing on you  <Text style={{ color: colors.primary }}>12</Text></Text>
        <Text style={styles.stat}>Your crushes  <Text style={{ color: colors.primary }}>8</Text></Text>
        <Text style={styles.stat}>Mutual  <Text style={{ color: colors.primary }}>4</Text></Text>
      </View>

      <FlatList
        data={data}
        keyExtractor={(_, i) => i.toString()}
        renderItem={({ item }) => (
          <View style={styles.crushItem}>
            <View style={styles.avatarSmall} />
            <View style={{ flex: 1 }}>
              <Text style={styles.crushName}>{item.name}</Text>
              <Text style={styles.crushTime}>{item.time}</Text>
            </View>
            <Icon name="heart" size={22} color={colors.primary} />
          </View>
        )}
      />
    </SafeAreaView>
  );
};

// 8. Messages
const MessagesList = ({ navigation }: any) => {
  const chats = [
    { name: 'Daniel', msg: 'That sounds amazing! 🔥', time: '2m', unread: 2 },
    { name: 'Jayden', msg: 'Hey handsome 😊', time: '15m', unread: 1 },
    { name: 'Marcus', msg: 'Voice message (0:12)', time: '1h' },
    { name: 'Tomi', msg: "I'm down for that. Where at?", time: '3h' },
    { name: 'Kelechi', msg: 'See you soon bro 👋', time: '5h' },
    { name: 'Ryan', msg: 'Sent a photo', time: '1d' },
  ];

  return (
    <SafeAreaView style={styles.container}>
      <Text style={styles.header}>Messages</Text>
      <TextInput
        style={styles.search}
        placeholder="Search conversations..."
        placeholderTextColor={colors.textMuted}
      />
      <FlatList
        data={chats}
        keyExtractor={(_, i) => i.toString()}
        renderItem={({ item }) => (
          <TouchableOpacity style={styles.chatItem} onPress={() => navigation.navigate('Chat')}>
            <View style={styles.avatarSmall} />
            <View style={{ flex: 1 }}>
              <Text style={styles.chatName}>{item.name}</Text>
              <Text style={styles.chatMsg} numberOfLines={1}>{item.msg}</Text>
            </View>
            <View style={{ alignItems: 'flex-end' }}>
              <Text style={styles.chatTime}>{item.time}</Text>
              {item.unread && (
                <View style={styles.badge}>
                  <Text style={styles.badgeText}>{item.unread}</Text>
                </View>
              )}
            </View>
          </TouchableOpacity>
        )}
      />
    </SafeAreaView>
  );
};

// 9. Chat
const ChatScreen = ({ navigation }: any) => (
  <SafeAreaView style={styles.container}>
    <View style={styles.chatHeader}>
      <TouchableOpacity onPress={() => navigation.goBack()}>
        <Icon name="chevron-back" size={28} color="#fff" />
      </TouchableOpacity>
      <View style={styles.avatarTiny} />
      <View>
        <Text style={styles.chatHeaderName}>Daniel</Text>
        <Text style={{ color: colors.online, fontSize: 12 }}>Online</Text>
      </View>
    </View>

    <ScrollView style={{ flex: 1, padding: 16 }}>
      <View style={styles.bubbleLeft}>
        <Text style={styles.bubbleText}>Hey bro! You're really cute 😊</Text>
      </View>
      <View style={styles.bubbleRight}>
        <Text style={styles.bubbleText}>Thanks man! You too 🔥</Text>
      </View>
      <View style={styles.bubbleLeft}>
        <Text style={styles.bubbleText}>What are you up to?</Text>
      </View>
      <View style={styles.bubbleRight}>
        <Text style={styles.bubbleText}>Just chilling. You?</Text>
      </View>
      <View style={styles.bubbleLeft}>
        <Text style={styles.bubbleText}>Same here. Wanna grab something later?</Text>
      </View>
    </ScrollView>

    <View style={styles.inputBar}>
      <Icon name="image" size={24} color={colors.textMuted} />
      <TextInput
        style={styles.chatInput}
        placeholder="Say something worth replying to..."
        placeholderTextColor={colors.textMuted}
      />
      <TouchableOpacity style={styles.sendBtn}>
        <Icon name="send" size={20} color="#fff" />
      </TouchableOpacity>
    </View>
  </SafeAreaView>
);

// 10. Moments
const MomentsFeed = () => (
  <SafeAreaView style={styles.container}>
    <Text style={styles.header}>Moments</Text>
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ paddingVertical: 12 }}>
      {['Your Moment', 'Jayden', 'Marcus', 'Tomi', 'Kelechi'].map((name, i) => (
        <View key={i} style={{ alignItems: 'center', marginHorizontal: 10 }}>
          <View style={[styles.storyCircle, i === 0 && { borderColor: colors.gold }]} />
          <Text style={{ color: colors.textSecondary, fontSize: 12, marginTop: 4 }}>{name}</Text>
        </View>
      ))}
    </ScrollView>

    <View style={styles.momentCard}>
      <Image
        source={{ uri: 'https://images.unsplash.com/photo-1517841905240-472988babdf9?w=600' }}
        style={styles.momentImage}
      />
      <Text style={styles.momentCaption}>Good energy only. ☀️</Text>
      <View style={styles.momentActions}>
        <Icon name="heart" size={22} color={colors.primary} />
        <Text style={{ color: colors.text, marginLeft: 6 }}>32</Text>
        <Icon name="chatbubble" size={20} color={colors.textSecondary} style={{ marginLeft: 20 }} />
      </View>
    </View>
  </SafeAreaView>
);

// 11. Profile
const ProfilePage = ({ navigation }: any) => (
  <ScrollView style={styles.container}>
    <View style={{ alignItems: 'center', paddingTop: 20 }}>
      <Image
        source={{ uri: 'https://images.unsplash.com/photo-1506794778202-cad84cf45f1d?w=400' }}
        style={styles.profileAvatar}
      />
      <Text style={styles.profileName}>Daniel, 24</Text>
      <Text style={{ color: colors.online }}>● Online · 3.2 km away</Text>
    </View>

    <View style={styles.section}>
      <Text style={styles.sectionTitle}>About me</Text>
      <Text style={styles.sectionText}>
        Soft heart, bad habits. Love good music, late night talks and real people. Let's vibe and see where it goes.
      </Text>
    </View>

    <View style={styles.section}>
      <Text style={styles.sectionTitle}>Looking for</Text>
      <Text style={styles.sectionText}>Dating · Relationship</Text>
    </View>

    <View style={styles.section}>
      <Text style={styles.sectionTitle}>Interests</Text>
      <View style={styles.tags}>
        {['Music', 'Fitness', 'Fashion', 'Travel', 'Movies', 'Food'].map(t => (
          <View key={t} style={styles.tag}><Text style={styles.tagText}>{t}</Text></View>
        ))}
      </View>
    </View>

    <PrimaryButton title="Edit Profile" onPress={() => {}} outline />
    <View style={{ height: 12 }} />
    <PrimaryButton title="Crushly Plus" onPress={() => navigation.navigate('Premium')} gold />
  </ScrollView>
);

// 12. Premium
const PremiumScreen = ({ navigation }: any) => (
  <ScrollView style={styles.container} contentContainerStyle={{ paddingBottom: 40 }}>
    <CrushlyLogo size={80} />
    <Text style={[styles.bigTitle, { marginTop: 20 }]}>Crushly Plus</Text>
    <Text style={styles.bigSub}>More ways to connect.</Text>

    {[
      'Advanced discovery',
      'Incognito mode',
      'Unlimited Deep Crushes',
      'Advanced filters',
      'Profile boosts',
      'Read receipts',
      'Travel mode',
      'Profile visibility controls',
    ].map((item, i) => (
      <View key={i} style={styles.premiumItem}>
        <Icon name="checkmark-circle" size={22} color={colors.gold} />
        <Text style={styles.premiumText}>{item}</Text>
      </View>
    ))}

    <PrimaryButton title="Go Premium" onPress={() => {}} gold />
  </ScrollView>
);

// 13. Settings
const SettingsScreen = ({ navigation }: any) => (
  <ScrollView style={styles.container}>
    <Text style={styles.header}>Settings</Text>

    {['Edit profile', 'Phone & email', 'Password', 'Account status'].map(item => (
      <TouchableOpacity key={item} style={styles.settingRow}>
        <Text style={styles.settingText}>{item}</Text>
        <Icon name="chevron-forward" size={20} color={colors.textMuted} />
      </TouchableOpacity>
    ))}

    <Text style={[styles.sectionTitle, { marginTop: 24 }]}>Discovery</Text>
    {['Preferences', 'Distance', 'Visibility', 'Incognito'].map(item => (
      <TouchableOpacity key={item} style={styles.settingRow}>
        <Text style={styles.settingText}>{item}</Text>
        <Icon name="chevron-forward" size={20} color={colors.textMuted} />
      </TouchableOpacity>
    ))}

    <Text style={[styles.sectionTitle, { marginTop: 24 }]}>Privacy</Text>
    {['Online status', 'Read receipts', 'Profile visibility'].map(item => (
      <TouchableOpacity key={item} style={styles.settingRow}>
        <Text style={styles.settingText}>{item}</Text>
        <Icon name="chevron-forward" size={20} color={colors.textMuted} />
      </TouchableOpacity>
    ))}
  </ScrollView>
);

// 14. Safety Center
const SafetyCenter = () => (
  <ScrollView style={styles.container}>
    <Text style={styles.header}>Safety Center</Text>
    <Text style={styles.headerSub}>Your safety matters.</Text>

    {[
      { icon: 'ban', title: 'Block user', desc: 'Block someone from your account' },
      { icon: 'flag', title: 'Report', desc: 'Report inappropriate behavior' },
      { icon: 'heart-dislike', title: 'Unmatch', desc: 'Remove this connection' },
      { icon: 'eye-off', title: 'Hide profile', desc: 'Make your profile invisible' },
      { icon: 'shield-checkmark', title: 'Privacy settings', desc: 'Control your data and visibility' },
      { icon: 'document-text', title: 'Community guidelines', desc: 'Keep Crushly a safe space' },
    ].map((item, i) => (
      <TouchableOpacity key={i} style={styles.safetyItem}>
        <Icon name={item.icon as any} size={24} color={colors.primary} />
        <View style={{ flex: 1, marginLeft: 16 }}>
          <Text style={styles.safetyTitle}>{item.title}</Text>
          <Text style={styles.safetyDesc}>{item.desc}</Text>
        </View>
        <Icon name="chevron-forward" size={20} color={colors.textMuted} />
      </TouchableOpacity>
    ))}
  </ScrollView>
);

// 15. Filters
const FiltersScreen = ({ navigation }: any) => (
  <ScrollView style={styles.container} contentContainerStyle={{ paddingBottom: 40 }}>
    <Text style={styles.header}>Filters</Text>

    <Text style={styles.filterLabel}>Age range</Text>
    <Text style={{ color: colors.text, marginBottom: 12 }}>18 – 35</Text>

    <Text style={styles.filterLabel}>Distance</Text>
    <Text style={{ color: colors.text, marginBottom: 12 }}>Within 25 km</Text>

    <Text style={styles.filterLabel}>Looking for</Text>
    <View style={styles.tags}>
      {['Dating', 'Relationship', 'Friends', 'Casual', 'Open to anything'].map(t => (
        <View key={t} style={styles.tag}><Text style={styles.tagText}>{t}</Text></View>
      ))}
    </View>

    <Text style={[styles.filterLabel, { marginTop: 24 }]}>Interests</Text>
    <View style={styles.tags}>
      {['Music', 'Fitness', 'Fashion', 'Gaming', 'Travel', 'Movies', 'Food', 'Art'].map(t => (
        <View key={t} style={styles.tag}><Text style={styles.tagText}>{t}</Text></View>
      ))}
    </View>

    <PrimaryButton title="Apply Filters" onPress={() => navigation.goBack()} />
  </ScrollView>
);

// ====================== NAVIGATION ======================
const Stack = createNativeStackNavigator();
const Tab = createBottomTabNavigator();

function MainTabs() {
  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarStyle: {
          backgroundColor: '#0d0d0d',
          borderTopColor: '#1a1a1a',
          height: 65,
          paddingBottom: 10,
        },
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: '#888',
        tabBarIcon: ({ color, size }) => {
          const icons: any = {
            Discover: 'compass',
            Crushes: 'heart',
            Messages: 'chatbubbles',
            Moments: 'images',
            Profile: 'person',
          };
          return <Icon name={icons[route.name]} size={size} color={color} />;
        },
      })}
    >
      <Tab.Screen name="Discover" component={DiscoverScreen} />
      <Tab.Screen name="Crushes" component={CrushesScreen} />
      <Tab.Screen name="Messages" component={MessagesList} />
      <Tab.Screen name="Moments" component={MomentsFeed} />
      <Tab.Screen name="Profile" component={ProfilePage} />
    </Tab.Navigator>
  );
}

export default function App() {
  return (
    <NavigationContainer>
      <StatusBar barStyle="light-content" backgroundColor="#000" />
      <Stack.Navigator screenOptions={{ headerShown: false, animation: 'fade' }}>
        <Stack.Screen name="Splash" component={SplashScreen} />
        <Stack.Screen name="OnboardingWelcome" component={OnboardingWelcome} />
        <Stack.Screen name="LookingFor" component={LookingForScreen} />
        <Stack.Screen name="ProfileSetup" component={ProfileSetupScreen} />
        <Stack.Screen name="MainTabs" component={MainTabs} />
        <Stack.Screen name="MutualCrush" component={MutualCrushScreen} />
        <Stack.Screen name="Chat" component={ChatScreen} />
        <Stack.Screen name="Premium" component={PremiumScreen} />
        <Stack.Screen name="Settings" component={SettingsScreen} />
        <Stack.Screen name="SafetyCenter" component={SafetyCenter} />
        <Stack.Screen name="Filters" component={FiltersScreen} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}

// ====================== STYLES ======================
const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
    paddingHorizontal: 20,
  },
  center: {
    flex: 1,
    backgroundColor: colors.background,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 24,
  },
  tagline: {
    color: colors.textSecondary,
    fontSize: 16,
    marginTop: 16,
  },
  welcomeTitle: {
    color: colors.text,
    fontSize: 28,
    fontWeight: '700',
    marginTop: 24,
    textAlign: 'center',
  },
  welcomeSub: {
    color: colors.textSecondary,
    fontSize: 16,
    textAlign: 'center',
    marginTop: 8,
    lineHeight: 24,
  },
  link: {
    color: colors.textSecondary,
    textAlign: 'center',
    marginTop: 20,
    marginBottom: 30,
  },
  screenTitle: {
    color: colors.text,
    fontSize: 26,
    fontWeight: '700',
    marginTop: 20,
  },
  screenSub: {
    color: colors.textSecondary,
    marginTop: 6,
  },
  header: {
    color: colors.text,
    fontSize: 28,
    fontWeight: '700',
    marginTop: 10,
  },
  headerSub: {
    color: colors.textSecondary,
    marginBottom: 16,
  },
  btn: {
    backgroundColor: colors.primary,
    paddingVertical: 16,
    borderRadius: 30,
    alignItems: 'center',
    marginHorizontal: 4,
  },
  btnGold: {
    backgroundColor: colors.gold,
  },
  btnOutline: {
    backgroundColor: 'transparent',
    borderWidth: 1.5,
    borderColor: colors.border,
  },
  btnText: {
    color: '#fff',
    fontSize: 17,
    fontWeight: '600',
  },
  chip: {
    backgroundColor: colors.surface,
    paddingVertical: 14,
    paddingHorizontal: 20,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: colors.border,
  },
  chipSelected: {
    backgroundColor: colors.primary + '22',
    borderColor: colors.primary,
  },
  chipText: {
    color: colors.textSecondary,
    fontSize: 16,
  },
  chipTextSelected: {
    color: colors.primary,
    fontWeight: '600',
  },
  input: {
    backgroundColor: colors.surface,
    borderRadius: 14,
    padding: 16,
    color: colors.text,
    marginBottom: 14,
    borderWidth: 1,
    borderColor: colors.border,
  },
  photoGrid: {
    marginVertical: 20,
  },
  photoPlaceholder: {
    height: 180,
    backgroundColor: colors.surface,
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: colors.border,
    borderStyle: 'dashed',
    justifyContent: 'center',
    alignItems: 'center',
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: 24,
    overflow: 'hidden',
    marginTop: 10,
  },
  cardImage: {
    width: '100%',
    height: 420,
  },
  cardInfo: {
    padding: 16,
  },
  cardName: {
    color: colors.text,
    fontSize: 22,
    fontWeight: '700',
  },
  cardBio: {
    color: colors.textSecondary,
    marginTop: 6,
    lineHeight: 20,
  },
  tags: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 12,
  },
  tag: {
    backgroundColor: '#222',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
  },
  tagText: {
    color: colors.text,
    fontSize: 13,
  },
  actions: {
    flexDirection: 'row',
    justifyContent: 'space-evenly',
    paddingVertical: 20,
  },
  circleBtn: {
    width: 58,
    height: 58,
    borderRadius: 29,
    backgroundColor: '#333',
    justifyContent: 'center',
    alignItems: 'center',
  },
  crushBtn: {
    backgroundColor: colors.primary,
    width: 70,
    height: 70,
    borderRadius: 35,
  },
  avatarLarge: {
    width: 110,
    height: 110,
    borderRadius: 55,
  },
  heartCircle: {
    width: 50,
    height: 50,
    borderRadius: 25,
    backgroundColor: colors.primary,
    justifyContent: 'center',
    alignItems: 'center',
    marginHorizontal: -15,
    zIndex: 2,
  },
  bigTitle: {
    color: colors.text,
    fontSize: 32,
    fontWeight: '700',
    textAlign: 'center',
  },
  bigSub: {
    color: colors.textSecondary,
    fontSize: 16,
    marginVertical: 12,
    marginBottom: 30,
    textAlign: 'center',
  },
  statsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginVertical: 16,
  },
  stat: {
    color: colors.textSecondary,
    fontSize: 13,
  },
  crushItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  avatarSmall: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: '#333',
    marginRight: 14,
  },
  crushName: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '600',
  },
  crushTime: {
    color: colors.textMuted,
    fontSize: 13,
    marginTop: 2,
  },
  search: {
    backgroundColor: colors.surface,
    borderRadius: 12,
    padding: 12,
    color: colors.text,
    marginVertical: 12,
  },
  chatItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
  },
  chatName: {
    color: colors.text,
    fontWeight: '600',
    fontSize: 16,
  },
  chatMsg: {
    color: colors.textSecondary,
    fontSize: 14,
    marginTop: 2,
  },
  chatTime: {
    color: colors.textMuted,
    fontSize: 12,
  },
  badge: {
    backgroundColor: colors.primary,
    width: 20,
    height: 20,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 4,
  },
  badgeText: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '700',
  },
  chatHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    gap: 12,
  },
  avatarTiny: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#333',
  },
  chatHeaderName: {
    color: colors.text,
    fontWeight: '600',
    fontSize: 16,
  },
  bubbleLeft: {
    backgroundColor: colors.surface,
    padding: 12,
    borderRadius: 18,
    borderBottomLeftRadius: 4,
    alignSelf: 'flex-start',
    marginBottom: 10,
    maxWidth: '75%',
  },
  bubbleRight: {
    backgroundColor: colors.primary,
    padding: 12,
    borderRadius: 18,
    borderBottomRightRadius: 4,
    alignSelf: 'flex-end',
    marginBottom: 10,
    maxWidth: '75%',
  },
  bubbleText: {
    color: colors.text,
    fontSize: 15,
  },
  inputBar: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    gap: 12,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  chatInput: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: 24,
    paddingHorizontal: 16,
    paddingVertical: 10,
    color: colors.text,
  },
  sendBtn: {
    backgroundColor: colors.primary,
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
  },
  storyCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    borderWidth: 2,
    borderColor: colors.primary,
    backgroundColor: '#333',
  },
  momentCard: {
    backgroundColor: colors.surface,
    borderRadius: 16,
    overflow: 'hidden',
    marginTop: 10,
  },
  momentImage: {
    width: '100%',
    height: 280,
  },
  momentCaption: {
    color: colors.text,
    padding: 12,
    fontSize: 15,
  },
  momentActions: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingBottom: 14,
  },
  profileAvatar: {
    width: 120,
    height: 120,
    borderRadius: 60,
  },
  profileName: {
    color: colors.text,
    fontSize: 24,
    fontWeight: '700',
    marginTop: 12,
  },
  section: {
    marginTop: 24,
  },
  sectionTitle: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 8,
  },
  sectionText: {
    color: colors.textSecondary,
    lineHeight: 22,
  },
  premiumItem: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: 10,
  },
  premiumText: {
    color: colors.text,
    fontSize: 16,
    marginLeft: 12,
  },
  settingRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  settingText: {
    color: colors.text,
    fontSize: 16,
  },
  safetyItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  safetyTitle: {
    color: colors.text,
    fontSize: 16,
    fontWeight: '500',
  },
  safetyDesc: {
    color: colors.textMuted,
    fontSize: 13,
    marginTop: 2,
  },
  filterLabel: {
    color: colors.textSecondary,
    fontSize: 14,
    marginTop: 20,
    marginBottom: 6,
  },
});
