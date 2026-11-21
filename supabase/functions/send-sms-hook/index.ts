// @ts-nocheck
// Supabase Edge Function: send-sms-hook
// Replaces previous implementation to integrate SMS Gate (https://sms-gate.app / capcom6/android-sms-gateway)
//
// Dual Purpose:
// 1. Supabase Auth Phone Login (Send SMS Hook for OTP verification)
// 2. Abucay Guardian Emergency SOS & Safety Alerts (Direct SMS dispatch from app)

import { Webhook } from "https://esm.sh/standardwebhooks@1.0.0";

declare const Deno: any;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req: Request) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const rawBody = await req.text();
    const headers = Object.fromEntries(req.headers);

    let user: { phone?: string } | null = null;
    let sms: { otp?: string; message?: string } | null = null;
    let directPhone: string | null = null;
    let directMessage: string | null = null;
    let parsed: any = {};
    let isAuthHook = false;

    // 1. Check if request is a signed webhook from Supabase Auth
    const hookSecretRaw = Deno.env.get("SEND_SMS_HOOK_SECRET");
    const hasSignature = Boolean(headers["webhook-signature"]);

    if (hookSecretRaw && hasSignature) {
      try {
        const hookSecret = hookSecretRaw.replace("v1,whsec_", "");
        const wh = new Webhook(hookSecret);
        const verified = wh.verify(rawBody, headers) as {
          user?: { phone: string };
          sms?: { otp: string };
        };
        user = verified.user || null;
        sms = verified.sms || null;
        isAuthHook = true;
      } catch (signErr) {
        console.error("Webhook signature verification failed:", signErr);
        return new Response(
          JSON.stringify({ error: { message: "Invalid webhook signature" } }),
          { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
    } else {
      // Direct call from app (e.g. SOS / Safety alerts) or standard JSON payload
      try {
        parsed = rawBody ? JSON.parse(rawBody) : {};
      } catch {
        parsed = {};
      }
      user = parsed.user || null;
      sms = parsed.sms || null;
      directPhone =
        parsed.phone ||
        parsed.user?.phone ||
        (Array.isArray(parsed.recipients) ? parsed.recipients[0] : null);
      directMessage = parsed.message || parsed.sms?.message;
    }

    // 2. Resolve recipient phone numbers (supports array of recipients for instant batching or single phone)
    let recipientPhones: string[] = [];
    if (Array.isArray(parsed.recipients) && parsed.recipients.length > 0) {
      recipientPhones = parsed.recipients;
    } else if (Array.isArray(parsed.phoneNumbers) && parsed.phoneNumbers.length > 0) {
      recipientPhones = parsed.phoneNumbers;
    } else {
      const single = directPhone || user?.phone;
      if (single) {
        recipientPhones = [single];
      }
    }

    if (recipientPhones.length === 0) {
      return new Response(
        JSON.stringify({ error: { message: "Missing recipient phone number(s)" } }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const formattedPhones = recipientPhones.map((p) => {
      const clean = String(p).trim();
      return clean.startsWith("+") ? clean : `+${clean}`;
    });

    // 3. Resolve SMS message text:
    // - 4-8 digit numeric code -> format as OTP verification code
    // - Full text / SOS distress message -> send message directly as-is!
    let messageToSend = "";
    const rawOtp = sms?.otp;

    if (directMessage && typeof directMessage === "string" && directMessage.trim().length > 0) {
      messageToSend = directMessage.trim();
    } else if (rawOtp) {
      const otpStr = String(rawOtp).trim();
      const isPureNumericOtp = /^\d{4,8}$/.test(otpStr);
      if (isPureNumericOtp) {
        messageToSend = `Your verification code is: ${otpStr}`;
      } else {
        // Full emergency alert or custom notification passed inside otp
        messageToSend = otpStr;
      }
    } else {
      return new Response(
        JSON.stringify({ error: { message: "Missing message or OTP code" } }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 4. Retrieve SMS Gate credentials & endpoint from Supabase Edge Function Secrets
    const smsGateUrl =
      Deno.env.get("SMSGATE_URL") || "https://api.sms-gate.app/3rdparty/v1/messages";
    const username = Deno.env.get("SMSGATE_USER");
    const password = Deno.env.get("SMSGATE_PASS");

    if (!username || !password) {
      throw new Error(
        "Missing SMS Gate credentials: SMSGATE_USER and SMSGATE_PASS secrets must be set in Supabase"
      );
    }

    const basicAuth = btoa(`${username}:${password}`);

    // Force SIM slot 2 as default (or allow override via body or SMSGATE_SIM_NUMBER)
    const simNumber =
      parsed?.simNumber ||
      (Deno.env.get("SMSGATE_SIM_NUMBER")
        ? parseInt(Deno.env.get("SMSGATE_SIM_NUMBER")!, 10)
        : 2);

    const smsGatePayload: Record<string, any> = {
      textMessage: {
        text: messageToSend,
      },
      phoneNumbers: formattedPhones, // Sends to all family members at once in a single instant batch!
      simNumber: simNumber, // Forces SIM slot 2 to prevent RESULT_RIL_MODEM_ERR
      priority: 100, // Priority >= 100 bypasses queue delays for instant OTP & SOS delivery
    };

    // 5. Send individual SMS via SMS Gate
    const response = await fetch(smsGateUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Basic ${basicAuth}`,
      },
      body: JSON.stringify(smsGatePayload),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`SMS Gate error (${response.status}): ${errorText}`);
    }

    const responseData = await response.json().catch(() => ({}));

    // If invoked as a Supabase Auth hook, Supabase Auth expects 200 OK with empty JSON `{}`
    if (isAuthHook) {
      return new Response(JSON.stringify({}), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // App client invocation (e.g. SOS alerts)
    return new Response(
      JSON.stringify({ success: true, data: responseData }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (err: any) {
    console.error("SMS dispatch error:", err);
    return new Response(
      JSON.stringify({ error: { message: err?.message || "Internal server error" } }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
