import { useCallback, useEffect, useRef } from 'react';
import {
  Animated,
  Easing,
  Image,
  StyleSheet,
  Text,
  useColorScheme,
  View,
} from 'react-native';
import { brand, spacing } from '../theme';

const ENTER_MS = 420;
const HOLD_MS = 780;
const EXIT_MS = 320;
// Dismissal must not depend on the animation reporting back: Fast Refresh and
// an interrupted sequence both cancel that callback.
const FAILSAFE_MS = ENTER_MS + HOLD_MS + EXIT_MS + 500;

/**
 * The in-app half of the launch sequence. The native splash (app.json) shows
 * the same mark on the same background, so this mounts over it seamlessly and
 * only adds the wordmark and credit before fading into the app.
 */
export default function Splash({ onFinish }: { onFinish: () => void }) {
  const scheme = useColorScheme();
  const background = scheme === 'dark' ? brand.splashBgDark : brand.splashBg;

  const enter = useRef(new Animated.Value(0)).current;
  const exit = useRef(new Animated.Value(1)).current;

  const done = useRef(false);
  const finish = useCallback(() => {
    if (done.current) return;
    done.current = true;
    onFinish();
  }, [onFinish]);

  useEffect(() => {
    const animation = Animated.sequence([
      Animated.timing(enter, {
        toValue: 1,
        duration: ENTER_MS,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.delay(HOLD_MS),
      Animated.timing(exit, {
        toValue: 0,
        duration: EXIT_MS,
        easing: Easing.in(Easing.quad),
        useNativeDriver: true,
      }),
    ]);

    animation.start(({ finished }) => {
      if (finished) finish();
    });
    const failsafe = setTimeout(finish, FAILSAFE_MS);

    return () => {
      clearTimeout(failsafe);
      animation.stop();
    };
  }, [enter, exit, finish]);

  const rise = enter.interpolate({ inputRange: [0, 1], outputRange: [14, 0] });

  return (
    <Animated.View
      accessibilityRole="header"
      accessibilityLabel={`${brand.name}. Designed and implemented by ${brand.author}.`}
      style={[styles.root, { backgroundColor: background, opacity: exit }]}>
      <View style={styles.centre}>
        <Animated.Image
          source={require('../../assets/splash-icon.png')}
          resizeMode="contain"
          style={[
            styles.mark,
            {
              opacity: enter,
              transform: [
                {
                  scale: enter.interpolate({
                    inputRange: [0, 1],
                    outputRange: [0.88, 1],
                  }),
                },
              ],
            },
          ]}
        />
        <Animated.View style={{ opacity: enter, transform: [{ translateY: rise }] }}>
          <Text style={styles.name}>{brand.name}</Text>
          <Text style={styles.tagline}>{brand.tagline}</Text>
        </Animated.View>
      </View>

      <Animated.View style={[styles.credit, { opacity: enter }]}>
        <Text style={styles.creditLabel}>Designed &amp; implemented by</Text>
        <Text style={styles.creditName}>{brand.author}</Text>
      </Animated.View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  root: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  centre: { alignItems: 'center', gap: spacing.xl },
  mark: { width: 116, height: 116 },
  name: {
    color: '#FFFFFF',
    fontSize: 30,
    fontWeight: '800',
    letterSpacing: 0.4,
    textAlign: 'center',
  },
  tagline: {
    color: 'rgba(255,255,255,0.66)',
    fontSize: 13,
    fontWeight: '600',
    letterSpacing: 0.2,
    marginTop: spacing.xs,
    textAlign: 'center',
  },
  credit: { position: 'absolute', bottom: 56, alignItems: 'center' },
  creditLabel: {
    color: 'rgba(255,255,255,0.5)',
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 1.3,
    textTransform: 'uppercase',
  },
  creditName: {
    color: 'rgba(255,255,255,0.94)',
    fontSize: 14,
    fontWeight: '700',
    letterSpacing: 0.3,
    marginTop: 3,
  },
});
