import AsyncStorage from '@react-native-async-storage/async-storage';

const CACHE_PREFIX = 'abucay_cache_';

export const cacheData = async <T>(key: string, data: T): Promise<void> => {
    try {
        await AsyncStorage.setItem(
            CACHE_PREFIX + key,
            JSON.stringify({ data, cachedAt: Date.now() })
        );
    } catch (e) {
        console.warn('Cache write failed:', e);
    }
};

export const getCachedData = async <T>(
    key: string,
    maxAgeMs: number = 24 * 60 * 60 * 1000 // 24 hours default
): Promise<T | null> => {
    try {
        const raw = await AsyncStorage.getItem(CACHE_PREFIX + key);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        if (Date.now() - parsed.cachedAt > maxAgeMs) return null;
        return parsed.data as T;
    } catch (e) {
        return null;
    }
};

export const clearCache = async (key: string): Promise<void> => {
    try {
        await AsyncStorage.removeItem(CACHE_PREFIX + key);
    } catch (e) {
        console.warn('Cache clear failed:', e);
    }
};

// Queue SOS events for offline sync
const SOS_QUEUE_KEY = 'sos_offline_queue';

export const queueSOSEvent = async (event: object): Promise<void> => {
    try {
        const raw = await AsyncStorage.getItem(SOS_QUEUE_KEY);
        const queue = raw ? JSON.parse(raw) : [];
        queue.push(event);
        await AsyncStorage.setItem(SOS_QUEUE_KEY, JSON.stringify(queue));
    } catch (e) {
        console.warn('SOS queue failed:', e);
    }
};

export const getSOSQueue = async (): Promise<object[]> => {
    try {
        const raw = await AsyncStorage.getItem(SOS_QUEUE_KEY);
        return raw ? JSON.parse(raw) : [];
    } catch {
        return [];
    }
};

export const clearSOSQueue = async (): Promise<void> => {
    try {
        await AsyncStorage.removeItem(SOS_QUEUE_KEY);
    } catch (e) {
        console.warn('SOS queue clear failed:', e);
    }
};

// Queue GPS locations tracked while offline for auto-sync when back online
const LOCATION_QUEUE_KEY = 'location_offline_queue';
const LAST_LOCATION_KEY = '@abucay_last_user_location';
const LAST_FETCH_TIME_KEY = '@abucay_last_fetch_timestamp';

export const queueLocationUpdate = async (locationPoint: object): Promise<void> => {
    try {
        const raw = await AsyncStorage.getItem(LOCATION_QUEUE_KEY);
        const queue = raw ? JSON.parse(raw) : [];
        queue.push({ ...locationPoint, queued_at: new Date().toISOString() });
        // Keep max 50 points to prevent storage bloat
        const trimmed = queue.slice(-50);
        await AsyncStorage.setItem(LOCATION_QUEUE_KEY, JSON.stringify(trimmed));
    } catch (e) {
        console.warn('Location queue failed:', e);
    }
};

export const getQueuedLocations = async (): Promise<any[]> => {
    try {
        const raw = await AsyncStorage.getItem(LOCATION_QUEUE_KEY);
        return raw ? JSON.parse(raw) : [];
    } catch {
        return [];
    }
};

export const clearLocationQueue = async (): Promise<void> => {
    try {
        await AsyncStorage.removeItem(LOCATION_QUEUE_KEY);
    } catch (e) {
        console.warn('Location queue clear failed:', e);
    }
};

export const saveLastKnownLocation = async (coords: { lat: number; lng: number }): Promise<void> => {
    try {
        await AsyncStorage.setItem(LAST_LOCATION_KEY, JSON.stringify(coords));
    } catch {}
};

export const getLastKnownLocation = async (): Promise<{ lat: number; lng: number } | null> => {
    try {
        const raw = await AsyncStorage.getItem(LAST_LOCATION_KEY);
        if (!raw) return null;
        return JSON.parse(raw);
    } catch {
        return null;
    }
};

export const saveLastFetchTimestamp = async (isoTimestamp: string): Promise<void> => {
    try {
        await AsyncStorage.setItem(LAST_FETCH_TIME_KEY, isoTimestamp);
    } catch {}
};

export const getLastFetchTimestamp = async (): Promise<string | null> => {
    try {
        return await AsyncStorage.getItem(LAST_FETCH_TIME_KEY);
    } catch {
        return null;
    }
};
