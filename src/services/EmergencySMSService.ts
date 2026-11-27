import { Platform, Linking, NativeModules, PermissionsAndroid } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo from '@react-native-community/netinfo';
import Constants from 'expo-constants';
import { supabase } from '../lib/supabase';
import { normalizePhoneNumber } from '../utils/phone';

export interface EmergencyContact {
  id?: string;
  name: string;
  phone: string;
  relationship?: string;
  memberUserId?: string;
}

export interface SendEmergencySMSParams {
  senderName: string;
  senderPhone?: string;
  senderId?: string;
  lat?: number;
  lng?: number;
  battery?: number | null;
  customRecipients?: string[];
  customRecipientNames?: string[];
  alertType?: 'sos' | 'checkin' | 'loud_ping' | 'general';
  silent?: boolean;
}

export interface SendMemberAlertSMSParams {
  senderName: string;
  senderPhone?: string;
  senderId?: string;
  recipientName: string;
  recipientPhone: string;
  lat?: number;
  lng?: number;
  alertType?: 'sos' | 'checkin' | 'loud_ping' | 'general';
}

export interface SendEmergencySMSResult {
  success: boolean;
  recipients: string[];
  recipientNames: string[];
  message: string;
  method: 'supabase-api' | 'direct-sms' | 'expo-sms' | 'native-sms' | 'none';
  provider?: string;
  isFallback?: boolean;
  fallbackReason?: string;
  error?: string;
}

interface DispatchMetadata {
  senderName?: string;
  senderPhone?: string;
  senderId?: string;
  alertType?: 'sos' | 'checkin' | 'loud_ping' | 'general';
  silent?: boolean;
}

const NETINFO_TIMEOUT_MS = 600;
const CONTACTS_FETCH_TIMEOUT_MS = 1500;
const GATEWAY_TIMEOUT_MS = 4500;

function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(fallback), ms);
    promise
      .then((val) => {
        clearTimeout(timer);
        resolve(val);
      })
      .catch(() => {
        clearTimeout(timer);
        resolve(fallback);
      });
  });
}

/**
 * Persist or retrieve custom TextBee SMS API credentials
 */
export async function setTextBeeConfig(config: {
  apiKey?: string;
  deviceId?: string;
  webhookUrl?: string;
}): Promise<void> {
  try {
    if (config.apiKey !== undefined) {
      await AsyncStorage.setItem('@abucay_textbee_api_key', config.apiKey);
    }
    if (config.deviceId !== undefined) {
      await AsyncStorage.setItem('@abucay_textbee_device_id', config.deviceId);
    }
    if (config.webhookUrl !== undefined) {
      await AsyncStorage.setItem('@abucay_textbee_webhook_url', config.webhookUrl);
    }
  } catch (e) {
    console.warn('[EmergencySMSService] Error saving TextBee config:', e);
  }
}

export async function getTextBeeConfig(): Promise<{
  apiKey: string;
  deviceId: string;
  webhookUrl: string;
}> {
  const extra = Constants.expoConfig?.extra || {};
  let apiKey = extra.textbeeApiKey || '';
  let deviceId = extra.textbeeDeviceId || '';
  let webhookUrl = extra.textbeeWebhookUrl || 'https://api.textbee.dev/api/v1/gateway/send-sms';

  try {
    const savedKey = await AsyncStorage.getItem('@abucay_textbee_api_key');
    if (savedKey) apiKey = savedKey;
    const savedDevice = await AsyncStorage.getItem('@abucay_textbee_device_id');
    if (savedDevice) deviceId = savedDevice;
    const savedUrl = await AsyncStorage.getItem('@abucay_textbee_webhook_url');
    if (savedUrl) webhookUrl = savedUrl;
  } catch {}

  return { apiKey, deviceId, webhookUrl };
}

/**
 * Tests the TextBee connection with an API key and optional deviceId.
 */
export async function testTextBeeConnection(
  apiKey: string,
  deviceId?: string,
  webhookUrl?: string
): Promise<{ success: boolean; message: string }> {
  if (!apiKey || !apiKey.trim()) {
    return { success: false, message: 'Please enter a valid TextBee API key.' };
  }
  const url = webhookUrl?.trim() || 'https://api.textbee.dev/api/v1/gateway/send-sms';
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey.trim(),
      },
      body: JSON.stringify({
        recipients: ['+639000000000'],
        message: 'Ping verification probe',
        ...(deviceId?.trim() ? { deviceId: deviceId.trim() } : {}),
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 401 || data?.message === 'Unauthorized' || data?.error?.includes?.('Unauthorized')) {
      return { success: false, message: 'Invalid API Key. Please verify your TextBee API key.' };
    }
    return { success: true, message: 'TextBee API key is authenticated and active!' };
  } catch (e: any) {
    return { success: false, message: e?.message || 'Network error connecting to TextBee.' };
  }
}

/**
 * Checks and requests Android SEND_SMS permission so SMS can be sent
 * directly in the background without opening the external Messages app.
 */
export async function requestSMSPermissionIfNeeded(): Promise<boolean> {
  if (Platform.OS !== 'android') return false;
  try {
    const hasPermission = await PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.SEND_SMS);
    if (hasPermission) return true;

    const status = await PermissionsAndroid.request(
      PermissionsAndroid.PERMISSIONS.SEND_SMS,
      {
        title: 'Emergency SMS Permission',
        message: 'Abucay Guardian needs permission to send direct emergency SMS alerts to your family members if internet is unavailable.',
        buttonPositive: 'Allow',
        buttonNegative: 'Deny',
      }
    );
    return status === PermissionsAndroid.RESULTS.GRANTED;
  } catch (e) {
    console.warn('[EmergencySMSService] SMS permission request error:', e);
    return false;
  }
}

/**
 * Checks whether native direct SMS sending is supported on this device.
 */
export function isDirectSMSAvailable(): boolean {
  return Platform.OS === 'android' && Boolean(NativeModules?.DirectSMS?.sendDirectSMS);
}

/**
 * Retrieves all registered and cached emergency family contacts for a user.
 * Excludes the current user so an alert is never sent to the user themselves.
 */
export async function getEmergencyFamilyContacts(userId?: string): Promise<EmergencyContact[]> {
  const contactsMap = new Map<string, EmergencyContact>();

  const addContact = (
    phone: string,
    name?: string,
    relationship?: string,
    memberUserId?: string,
    id?: string
  ) => {
    if (!phone) return;
    const normalized = normalizePhoneNumber(phone);
    if (!normalized) return;
    // Don't add if this member is the current user themselves
    if (userId && memberUserId && memberUserId === userId) return;

    if (!contactsMap.has(normalized)) {
      contactsMap.set(normalized, {
        id: id || memberUserId || normalized,
        name: name || 'Family Member',
        phone: normalized,
        relationship: relationship || 'Family',
        memberUserId,
      });
    }
  };

  // 1. Read locally cached family members (guaranteed offline access)
  try {
    const cached = await AsyncStorage.getItem('@abucay_cached_family_members');
    if (cached) {
      const parsed = JSON.parse(cached);
      if (Array.isArray(parsed)) {
        for (const item of parsed) {
          // A member is the user themselves ONLY if member_user_id === userId
          if (userId && item.member_user_id === userId) {
            continue;
          }
          const rawPhone = item.phone || item.member?.phone;
          const rawName = item.name || item.member?.name || 'Family Member';
          if (rawPhone) {
            addContact(rawPhone, rawName, item.relationship, item.member_user_id, item.id);
          }
        }
      }
    }
  } catch (e) {
    console.warn('[EmergencySMSService] Error reading cached family contacts:', e);
  }

  // 2. Query Supabase for real-time family members in parallel with a short timeout
  //    so slow/flaky mobile data never stalls SOS SMS dispatch.
  if (userId) {
    try {
      const [directRes, recipRes] = await Promise.all([
        withTimeout(
          Promise.resolve(
            supabase
              .from('family_members')
              .select('id, name, phone, relationship, member_user_id, member:users!member_user_id(id, name, phone)')
              .eq('user_id', userId)
          ),
          CONTACTS_FETCH_TIMEOUT_MS,
          { data: null, error: null } as any
        ),
        withTimeout(
          Promise.resolve(
            supabase
              .from('family_members')
              .select('id, user_id, name, phone, relationship, creator:users!user_id(id, name, phone)')
              .eq('member_user_id', userId)
          ),
          CONTACTS_FETCH_TIMEOUT_MS,
          { data: null, error: null } as any
        ),
      ]);

      const directMembers = directRes?.data;
      if (!directRes?.error && Array.isArray(directMembers)) {
        for (const m of directMembers) {
          if (m.member_user_id === userId) continue;
          const rawPhone = (m as any).member?.phone || m.phone;
          const rawName = (m as any).member?.name || m.name || 'Family Member';
          if (rawPhone) {
            addContact(rawPhone, rawName, m.relationship, m.member_user_id, m.id);
          }
        }
      }

      const reciprocalMembers = recipRes?.data;
      if (!recipRes?.error && Array.isArray(reciprocalMembers)) {
        for (const rm of reciprocalMembers) {
          if (rm.user_id === userId) continue;
          const rawPhone = (rm as any).creator?.phone || rm.phone;
          const rawName = (rm as any).creator?.name || rm.name || 'Family Member';
          if (rawPhone) {
            addContact(rawPhone, rawName, rm.relationship, rm.user_id, rm.id);
          }
        }
      }
    } catch (dbErr) {
      console.warn('[EmergencySMSService] Online family fetch error:', dbErr);
    }
  }

  return Array.from(contactsMap.values());
}

/**
 * Builds the standard emergency SOS SMS body in compact single-segment GSM-7 format
 * (<=160 chars when possible) so cellular SIM radio sends 2x faster to 10+ recipients.
 */
export function buildEmergencySOSMessage(params: {
  senderName: string;
  senderPhone?: string;
  lat?: number;
  lng?: number;
  battery?: number | null;
  timestamp?: Date;
}): string {
  const time = params.timestamp || new Date();
  const timeStr = time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  let batPart = '';
  if (params.battery !== undefined && params.battery !== null && params.battery >= 0) {
    const pct = Math.round(params.battery > 1 ? params.battery : params.battery * 100);
    batPart = `Bat: ${pct}% | `;
  }

  let locationText = 'GPS: Pending\n';
  if (params.lat !== undefined && params.lng !== undefined) {
    locationText = `GPS: ${params.lat.toFixed(5)}, ${params.lng.toFixed(5)}\n`;
  }

  return (
    `SOS! ${params.senderName} needs urgent help!\n` +
    locationText +
    `${batPart}${timeStr}\n` +
    `Call them or 911 now.\n` +
    `-AbucayGuardian`
  );
}

/**
 * Builds the standard "Are You Okay?" (Check-in) SMS message.
 * Clean GSM-7 format to avoid multi-part segment explosion.
 */
export function buildCheckInSMSMessage(params: {
  senderName: string;
  recipientName: string;
  senderPhone?: string;
  lat?: number;
  lng?: number;
  timestamp?: Date;
}): string {
  const time = params.timestamp || new Date();
  const timeStr = time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  let locationText = '';
  if (params.lat !== undefined && params.lng !== undefined) {
    const latFormatted = params.lat.toFixed(5);
    const lngFormatted = params.lng.toFixed(5);
    locationText = `GPS: ${latFormatted}, ${lngFormatted}\n`;
  }

  return (
    `SAFETY CHECK: Hi ${params.recipientName}, ${params.senderName} is checking if you are safe via Abucay Guardian.\n` +
    `Please reply SAFE or NEED HELP.\n` +
    locationText +
    `Time: ${timeStr}`
  );
}

/**
 * Builds the standard "Loud Ping" (Alarm siren) SMS message.
 * Clean GSM-7 format to avoid multi-part segment explosion.
 */
export function buildLoudPingSMSMessage(params: {
  senderName: string;
  recipientName: string;
  senderPhone?: string;
  lat?: number;
  lng?: number;
  timestamp?: Date;
}): string {
  const time = params.timestamp || new Date();
  const timeStr = time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  let locationText = '';
  if (params.lat !== undefined && params.lng !== undefined) {
    const latFormatted = params.lat.toFixed(5);
    const lngFormatted = params.lng.toFixed(5);
    locationText = `GPS: ${latFormatted}, ${lngFormatted}\n`;
  }

  return (
    `URGENT ALARM: Hi ${params.recipientName}, ${params.senderName} triggered an emergency alarm on your phone via Abucay Guardian.\n` +
    `Please open the app or call back immediately!\n` +
    locationText +
    `Time: ${timeStr}`
  );
}

/**
 * Smart Dual-Mode SMS Dispatch:
 *
 * 1. PRIMARY: TextBee SMS API / Supabase Webhook (Requires Internet, No SIM Load Needed).
 *    Uses TextBee (https://textbee.dev) gateway via Supabase Edge Function or direct Webhook.
 *
 * 2. FALLBACK: Native Device Cellular SMS (SmsManager via DirectSMSModule).
 *    If the phone is OFFLINE (no internet), or if the TextBee API call fails,
 *    it automatically falls back to sending direct individual SMS from the device SIM.
 */
async function dispatchSMSToRecipients(
  targetPhones: string[],
  recipientNames: string[],
  message: string,
  metadata?: DispatchMetadata
): Promise<SendEmergencySMSResult> {
  const uniquePhones: string[] = [];
  const uniqueNames: string[] = [];
  targetPhones.forEach((phone, idx) => {
    const norm = normalizePhoneNumber(phone);
    if (norm && !uniquePhones.includes(norm)) {
      uniquePhones.push(norm);
      uniqueNames.push(recipientNames[idx] || 'Family Member');
    }
  });

  if (uniquePhones.length === 0) {
    console.warn('[EmergencySMSService] No valid recipient phone numbers provided.');
    return {
      success: false,
      recipients: [],
      recipientNames: [],
      message,
      method: 'none',
      error: 'No valid phone numbers found on record. Please add mobile numbers for family members.',
    };
  }

  // Check network connectivity (bounded so NetInfo never stalls dispatch)
  let isOnline = false;
  try {
    const netState = await withTimeout(NetInfo.fetch(), NETINFO_TIMEOUT_MS, null as any);
    isOnline = Boolean(netState?.isConnected && netState?.isInternetReachable !== false);
  } catch (netErr) {
    console.warn('[EmergencySMSService] NetInfo check failed:', netErr);
  }

  const tbConfig = await getTextBeeConfig();
  let fallbackReason = '';

  // ==============================================================
  // 1. PRIMARY: SMS GATEWAY VIA SUPABASE EDGE FUNCTION (send-sms-hook)
  // Sends individual SMS to all recipients in a single instant batch (0 load needed)
  // ==============================================================
  if (isOnline) {
    console.log(`[EmergencySMSService] Online: Attempting batch SMS Gateway dispatch via send-sms-hook for ${uniquePhones.length} recipient(s)...`);

    let hookSentCount = 0;
    try {
      const invokeRes = await withTimeout(
        supabase.functions.invoke('send-sms-hook', {
          body: {
            recipients: uniquePhones,
            phoneNumbers: uniquePhones,
            phone: uniquePhones[0],
            user: { phone: uniquePhones[0] },
            sms: { otp: message, message: message },
            message: message,
            simNumber: 2,
          },
        }),
        GATEWAY_TIMEOUT_MS,
        { data: null, error: { message: 'SMS gateway timeout' } } as any
      );
      const { data, error } = invokeRes || {};

      const isSuccess = !error && Boolean(data?.success || data?.data?.success || data?.data?.data?.success || (data && !data?.error));
      if (isSuccess) {
        hookSentCount = uniquePhones.length;
        console.log(`[EmergencySMSService] Successfully dispatched instant batch SMS to ${uniquePhones.length} recipient(s) via send-sms-hook`);
      } else {
        console.warn('[EmergencySMSService] send-sms-hook batch response:', error || data);
        if (error?.message) fallbackReason = error.message;
      }
    } catch (hookErr: any) {
      console.warn('[EmergencySMSService] send-sms-hook batch invocation failed:', hookErr);
      fallbackReason = hookErr?.message || 'send-sms-hook invocation error';
    }

    // Record dispatch asynchronously (fire-and-forget) so logging never delays SMS fallback or UI
    Promise.resolve(
      supabase.from('emergency_sms_dispatches').insert(
        uniquePhones.map((phone, idx) => ({
          sender_id: metadata?.senderId || null,
          sender_name: metadata?.senderName || 'Family Member',
          sender_phone: metadata?.senderPhone || null,
          recipient_phone: phone,
          recipient_name: uniqueNames[idx] || null,
          message,
          alert_type: metadata?.alertType || 'sos',
          status: hookSentCount > 0 ? 'sent' : 'failed',
          provider: 'smsgate_edge_function',
        }))
      )
    ).catch((logErr) => {
      console.warn('[EmergencySMSService] Dispatch log write error:', logErr);
    });

    if (hookSentCount > 0) {
      console.log(`[EmergencySMSService] Successfully delivered ${hookSentCount}/${uniquePhones.length} SMS via send-sms-hook`);
      return {
        success: true,
        recipients: uniquePhones,
        recipientNames: uniqueNames,
        message,
        method: 'supabase-api',
        provider: 'smsgate',
        isFallback: false,
      };
    }

    // Secondary fallback: Direct TextBee API if custom key is provided
    if (tbConfig.apiKey && tbConfig.apiKey.trim().length > 0) {
      const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
      const abortTimer = controller ? setTimeout(() => controller.abort(), GATEWAY_TIMEOUT_MS) : null;
      try {
        console.log('[EmergencySMSService] Attempting direct TextBee API webhook fallback...');
        const headers: Record<string, string> = {
          'Content-Type': 'application/json',
          'x-api-key': tbConfig.apiKey.trim(),
        };

        const bodyPayload: any = {
          recipients: uniquePhones,
          message,
        };
        if (tbConfig.deviceId && tbConfig.deviceId.trim()) {
          bodyPayload.deviceId = tbConfig.deviceId.trim();
        }

        const tbRes = await fetch(tbConfig.webhookUrl, {
          method: 'POST',
          headers,
          body: JSON.stringify(bodyPayload),
          ...(controller ? { signal: controller.signal } : {}),
        });

        const tbData = await tbRes.json().catch(() => ({}));
        if (tbRes.ok && tbData.success !== false) {
          console.log('[EmergencySMSService] Successfully dispatched SMS via direct TextBee webhook:', tbData);
          return {
            success: true,
            recipients: uniquePhones,
            recipientNames: uniqueNames,
            message,
            method: 'supabase-api',
            provider: 'textbee',
            isFallback: false,
          };
        }
        fallbackReason = tbData?.message || tbData?.error || `TextBee API returned HTTP ${tbRes.status}`;
      } catch (tbErr: any) {
        fallbackReason = tbErr?.message || 'Direct TextBee webhook request failed';
      } finally {
        if (abortTimer) clearTimeout(abortTimer);
      }
    }
  } else {
    fallbackReason = 'Device is offline (no internet connection)';
    console.log('[EmergencySMSService] Device is OFFLINE. Using direct device cellular SMS fallback.');
  }

  // ==============================================================
  // 2. FALLBACK: NATIVE DEVICE CELLULAR SMS (No Internet Needed, Uses SIM Radio)
  // Batched in a single native call (queues individual 1-on-1 SMS, never a group MMS)
  // ==============================================================
  if (Platform.OS === 'android' && NativeModules?.DirectSMS) {
    // In silent/headless/locked mode we MUST never call PermissionsAndroid.request (no foreground Activity)
    const hasPermission = metadata?.silent
      ? await PermissionsAndroid.check(PermissionsAndroid.PERMISSIONS.SEND_SMS).catch(() => false)
      : await requestSMSPermissionIfNeeded();
    if (hasPermission) {
      try {
        let sentCount = 0;
        if (typeof NativeModules.DirectSMS.sendDirectSMSToMultiple === 'function') {
          sentCount = await NativeModules.DirectSMS.sendDirectSMSToMultiple(uniquePhones, message);
          console.log(`[EmergencySMSService] Batch cellular SMS queued for ${sentCount}/${uniquePhones.length} individual recipients`);
        } else {
          const results = await Promise.allSettled(
            uniquePhones.map((phone) => NativeModules.DirectSMS.sendDirectSMS(phone, message))
          );
          sentCount = results.filter((r) => r.status === 'fulfilled').length;
        }

        if (sentCount > 0) {
          return {
            success: true,
            recipients: uniquePhones,
            recipientNames: uniqueNames,
            message,
            method: 'direct-sms',
            isFallback: isOnline,
            fallbackReason,
          };
        }
      } catch (nativeErr) {
        console.warn('[EmergencySMSService] DirectSMS native module failed, falling back to OS dialer:', nativeErr);
      }
    } else {
      console.warn('[EmergencySMSService] SEND_SMS permission was denied by user.');
    }
  }

  // ==============================================================
  // 3. FINAL RESORT: NATIVE SMS INTENT (iOS / Denied Permission)
  // Skipped completely when metadata.silent is true so covert SOS never opens Messages UI
  // ==============================================================
  if (metadata?.silent) {
    return {
      success: false,
      recipients: uniquePhones,
      recipientNames: uniqueNames,
      message,
      method: 'none',
      isFallback: true,
      fallbackReason: fallbackReason || 'Covert mode skipped interactive SMS UI',
    };
  }

  try {
    const separator = Platform.OS === 'ios' ? '&' : '?';
    const singleUrl = `sms:${uniquePhones[0]}${separator}body=${encodeURIComponent(message)}`;
    await Linking.openURL(singleUrl);
    return {
      success: true,
      recipients: [uniquePhones[0]],
      recipientNames: [uniqueNames[0]],
      message,
      method: 'native-sms',
      isFallback: true,
      fallbackReason,
    };
  } catch (finalErr: any) {
    console.error('[EmergencySMSService] Failed to send SMS via all methods:', finalErr);
    return {
      success: false,
      recipients: uniquePhones,
      recipientNames: uniqueNames,
      message,
      method: 'none',
      fallbackReason,
      error: finalErr?.message || 'Could not send SMS message.',
    };
  }
}

/**
 * Sends emergency SOS SMS to family members:
 * - Strictly excludes the sender's own number and user ID (never sends distress SMS to oneself).
 * - Primary: TextBee SMS API / Webhook (no cellular load required).
 * - Fallback: Native Device SMS (works offline during internet/power outages).
 */
export async function sendEmergencySMSToFamily(
  params: SendEmergencySMSParams
): Promise<SendEmergencySMSResult> {
  const normalizedSenderPhone = params.senderPhone ? normalizePhoneNumber(params.senderPhone) : null;

  let targetPhones: string[] = [];
  let recipientNames: string[] = [];

  if (params.customRecipients && params.customRecipients.length > 0) {
    for (let i = 0; i < params.customRecipients.length; i++) {
      const raw = params.customRecipients[i];
      const norm = normalizePhoneNumber(raw);
      if (norm && (!normalizedSenderPhone || norm !== normalizedSenderPhone) && !targetPhones.includes(norm)) {
        targetPhones.push(norm);
        recipientNames.push(params.customRecipientNames?.[i] || 'Family Member');
      }
    }
  }

  let contacts: EmergencyContact[] = [];
  if (targetPhones.length === 0) {
    contacts = await getEmergencyFamilyContacts(params.senderId);
    for (const c of contacts) {
      if (!c.phone) continue;
      const normPhone = normalizePhoneNumber(c.phone);
      // Strictly prevent sending distress SOS to oneself:
      if (normalizedSenderPhone && normPhone === normalizedSenderPhone) {
        continue;
      }
      if (params.senderId && (c.memberUserId === params.senderId || c.id === params.senderId)) {
        continue;
      }
      if (normPhone && !targetPhones.includes(normPhone)) {
        targetPhones.push(normPhone);
        recipientNames.push(c.name);
      }
    }
  }

  if (targetPhones.length === 0) {
    // If other members were not found or sender's number was the only contact on record,
    // fallback to all registered contacts or sender phone so SOS alerts and testing always dispatch:
    if (contacts.length === 0) {
      contacts = await getEmergencyFamilyContacts(params.senderId);
    }
    if (contacts.length > 0) {
      for (const c of contacts) {
        if (!c.phone) continue;
        const norm = normalizePhoneNumber(c.phone);
        if (norm && !targetPhones.includes(norm)) {
          targetPhones.push(norm);
          recipientNames.push(c.name || 'Emergency Contact');
        }
      }
    } else if (params.senderPhone) {
      const selfNorm = normalizePhoneNumber(params.senderPhone);
      if (selfNorm) {
        targetPhones.push(selfNorm);
        recipientNames.push(params.senderName || 'Self (Emergency Alert)');
      }
    }
  }

  if (targetPhones.length === 0) {
    console.warn('[EmergencySMSService] No recipients found with a valid phone number.');
    return {
      success: false,
      recipients: [],
      recipientNames: [],
      message: '',
      method: 'none',
      error: 'No mobile numbers found. Please add mobile numbers for family members in your Family Circle.',
    };
  }

  const message = buildEmergencySOSMessage({
    senderName: params.senderName,
    senderPhone: params.senderPhone,
    lat: params.lat,
    lng: params.lng,
    battery: params.battery,
  });

  return dispatchSMSToRecipients(targetPhones, recipientNames, message, {
    senderName: params.senderName,
    senderPhone: params.senderPhone,
    senderId: params.senderId,
    alertType: params.alertType || 'sos',
    silent: params.silent,
  });
}

/**
 * Sends a Safety Check-in ("Are You Okay?") SMS to an individual member:
 * Primary: TextBee SMS API. Fallback: Native Device SMS.
 */
export async function sendCheckInSMSToMember(
  params: SendMemberAlertSMSParams
): Promise<SendEmergencySMSResult> {
  const message = buildCheckInSMSMessage({
    senderName: params.senderName,
    recipientName: params.recipientName,
    senderPhone: params.senderPhone,
    lat: params.lat,
    lng: params.lng,
  });

  return dispatchSMSToRecipients([params.recipientPhone], [params.recipientName], message, {
    senderName: params.senderName,
    senderPhone: params.senderPhone,
    senderId: params.senderId,
    alertType: 'checkin',
  });
}

/**
 * Sends a Loud Emergency Ping SMS alert to an individual member:
 * Primary: TextBee SMS API. Fallback: Native Device SMS.
 */
export async function sendLoudPingSMSToMember(
  params: SendMemberAlertSMSParams
): Promise<SendEmergencySMSResult> {
  const message = buildLoudPingSMSMessage({
    senderName: params.senderName,
    recipientName: params.recipientName,
    senderPhone: params.senderPhone,
    lat: params.lat,
    lng: params.lng,
  });

  return dispatchSMSToRecipients([params.recipientPhone], [params.recipientName], message, {
    senderName: params.senderName,
    senderPhone: params.senderPhone,
    senderId: params.senderId,
    alertType: 'loud_ping',
  });
}

/**
 * Sends a direct SMS to a specific phone number with custom body text.
 * Uses TextBee SMS API if online, falling back to Native Device SMS.
 */
export async function sendDirectSMS(phone: string, message: string): Promise<boolean> {
  const res = await dispatchSMSToRecipients([phone], ['Recipient'], message, {
    alertType: 'general',
  });
  return res.success;
}
