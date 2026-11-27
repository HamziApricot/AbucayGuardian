// Follow this setup guide to integrate the Deno language server with your editor:
// https://deno.land/manual/getting_started/setup_your_environment
// This code runs on Supabase Edge Functions (Deno runtime)

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface RequestPayload {
  recipients: string[];
  recipientNames?: string[];
  message: string;
  senderName?: string;
  senderPhone?: string;
  senderId?: string;
  alertType?: "sos" | "checkin" | "loud_ping" | "general";
  textbeeApiKey?: string;
  textbeeDeviceId?: string;
  textbeeWebhookUrl?: string;
}

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const payload: RequestPayload = await req.json();
    const {
      recipients,
      recipientNames = [],
      message,
      senderName = "Family Member",
      senderPhone,
      senderId,
      alertType = "sos",
      textbeeApiKey: reqTextbeeApiKey,
      textbeeDeviceId: reqTextbeeDeviceId,
      textbeeWebhookUrl: reqTextbeeWebhookUrl,
    } = payload;

    if (!recipients || !Array.isArray(recipients) || recipients.length === 0) {
      return new Response(
        JSON.stringify({ success: false, error: "No recipients provided" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!message || typeof message !== "string") {
      return new Response(
        JSON.stringify({ success: false, error: "Empty SMS message body" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 1. TextBee SMS Gateway (https://textbee.dev) - Primary
    const textbeeApiKey = reqTextbeeApiKey || Deno.env.get("TEXTBEE_API_KEY");
    const textbeeDeviceId = reqTextbeeDeviceId || Deno.env.get("TEXTBEE_DEVICE_ID");
    const textbeeWebhookUrl = reqTextbeeWebhookUrl || Deno.env.get("TEXTBEE_WEBHOOK_URL") || "https://api.textbee.dev/api/v1/gateway/send-sms";

    // 2. Secondary Philippine & Global Providers
    const semaphoreApiKey = Deno.env.get("SEMAPHORE_API_KEY");
    const semaphoreSenderName = Deno.env.get("SEMAPHORE_SENDER_NAME") || "SEMAPHORE";

    const philSmsToken = Deno.env.get("PHILSMS_API_TOKEN");
    const philSmsSenderId = Deno.env.get("PHILSMS_SENDER_ID") || "PhilSMS";

    const twilioAccountSid = Deno.env.get("TWILIO_ACCOUNT_SID");
    const twilioAuthToken = Deno.env.get("TWILIO_AUTH_TOKEN");
    const twilioPhoneNumber = Deno.env.get("TWILIO_PHONE_NUMBER");

    const customWebhookUrl = Deno.env.get("SMS_WEBHOOK_URL");

    // Initialize Supabase admin client for logging (if service role is available)
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const supabase = (supabaseUrl && supabaseServiceKey)
      ? createClient(supabaseUrl, supabaseServiceKey)
      : null;

    let providerUsed = "none";
    let sentCount = 0;
    const errors: Array<{ recipient: string; error: string }> = [];

    // ==============================================================
    // PROVIDER 1: TEXTBEE (https://textbee.dev SMS API & Webhook)
    // ==============================================================
    if (textbeeApiKey || Deno.env.get("TEXTBEE_WEBHOOK_URL")) {
      providerUsed = "textbee";
      try {
        const headers: Record<string, string> = {
          "Content-Type": "application/json",
        };
        if (textbeeApiKey) {
          headers["x-api-key"] = textbeeApiKey;
        }

        const bodyPayload: any = {
          recipients: recipients,
          message: message,
        };
        if (textbeeDeviceId) {
          bodyPayload.deviceId = textbeeDeviceId;
        }

        const res = await fetch(textbeeWebhookUrl, {
          method: "POST",
          headers,
          body: JSON.stringify(bodyPayload),
        });

        const resData = await res.json().catch(() => ({}));
        if (res.ok && resData.success !== false) {
          sentCount = recipients.length;
        } else {
          errors.push({ recipient: "all", error: JSON.stringify(resData) });
        }
      } catch (err: any) {
        errors.push({ recipient: "all", error: err?.message || "TextBee dispatch failed" });
      }
    }
    // ==============================================================
    // PROVIDER 2: SEMAPHORE (Philippines Alternative - Parallel Batch)
    // ==============================================================
    else if (semaphoreApiKey) {
      providerUsed = "semaphore";
      await Promise.allSettled(
        recipients.map(async (recipient) => {
          try {
            const res = await fetch("https://api.semaphore.co/api/v4/messages", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                apikey: semaphoreApiKey,
                number: recipient,
                message: message,
                sendername: semaphoreSenderName,
              }),
            });
            const resData = await res.json();
            if (res.ok) {
              sentCount++;
            } else {
              errors.push({ recipient, error: JSON.stringify(resData) });
            }
          } catch (err: any) {
            errors.push({ recipient, error: err?.message || "Semaphore dispatch failed" });
          }
        })
      );
    }
    // ==============================================================
    // PROVIDER 3: PHILSMS (Philippines Alternative - Parallel Batch)
    // ==============================================================
    else if (philSmsToken) {
      providerUsed = "philsms";
      await Promise.allSettled(
        recipients.map(async (recipient) => {
          try {
            const res = await fetch("https://dashboard.philsms.com/api/v3/sms/send", {
              method: "POST",
              headers: {
                "Authorization": `Bearer ${philSmsToken}`,
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                recipient: recipient,
                sender_id: philSmsSenderId,
                type: "plain",
                message: message,
              }),
            });
            const resData = await res.json();
            if (res.ok && resData.status !== "error") {
              sentCount++;
            } else {
              errors.push({ recipient, error: JSON.stringify(resData) });
            }
          } catch (err: any) {
            errors.push({ recipient, error: err?.message || "PhilSMS dispatch failed" });
          }
        })
      );
    }
    // ==============================================================
    // PROVIDER 4: TWILIO (Global Gateway - Parallel Batch)
    // ==============================================================
    else if (twilioAccountSid && twilioAuthToken && twilioPhoneNumber) {
      providerUsed = "twilio";
      const authHeader = "Basic " + btoa(`${twilioAccountSid}:${twilioAuthToken}`);
      await Promise.allSettled(
        recipients.map(async (recipient) => {
          try {
            const formData = new URLSearchParams();
            formData.append("To", recipient);
            formData.append("From", twilioPhoneNumber);
            formData.append("Body", message);

            const res = await fetch(
              `https://api.twilio.com/2010-04-01/Accounts/${twilioAccountSid}/Messages.json`,
              {
                method: "POST",
                headers: {
                  "Authorization": authHeader,
                  "Content-Type": "application/x-www-form-urlencoded",
                },
                body: formData.toString(),
              }
            );
            const resData = await res.json();
            if (res.ok) {
              sentCount++;
            } else {
              errors.push({ recipient, error: JSON.stringify(resData) });
            }
          } catch (err: any) {
            errors.push({ recipient, error: err?.message || "Twilio dispatch failed" });
          }
        })
      );
    }
    // ==============================================================
    // PROVIDER 5: CUSTOM SMS WEBHOOK URL
    // ==============================================================
    else if (customWebhookUrl) {
      providerUsed = "custom_webhook";
      try {
        const res = await fetch(customWebhookUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            recipients,
            recipientNames,
            message,
            senderName,
            senderPhone,
            senderId,
            alertType,
            timestamp: new Date().toISOString(),
          }),
        });
        if (res.ok) {
          sentCount = recipients.length;
        } else {
          errors.push({ recipient: "all", error: `Webhook returned status ${res.status}` });
        }
      } catch (err: any) {
        errors.push({ recipient: "all", error: err?.message || "Custom webhook failed" });
      }
    }
    // ==============================================================
    // NO CLOUD PROVIDER CONFIGURED
    // ==============================================================
    else {
      return new Response(
        JSON.stringify({
          success: false,
          error: "NO_SMS_PROVIDER_CONFIGURED",
          message: "No cloud SMS gateway configured in Supabase secrets (set TEXTBEE_API_KEY, SEMAPHORE_API_KEY, PHILSMS_API_TOKEN, or SMS_WEBHOOK_URL).",
        }),
        { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Log dispatches into Supabase emergency_sms_dispatches table if available
    if (supabase) {
      try {
        const records = recipients.map((phone, idx) => ({
          sender_id: senderId || null,
          sender_name: senderName,
          sender_phone: senderPhone || null,
          recipient_phone: phone,
          recipient_name: recipientNames[idx] || null,
          message: message,
          alert_type: alertType,
          status: sentCount > 0 ? "sent" : "failed",
          provider: providerUsed,
          error_message: errors.find((e) => e.recipient === phone)?.error || null,
        }));
        await supabase.from("emergency_sms_dispatches").insert(records);
      } catch (logErr) {
        console.warn("Failed to log sms dispatches to table:", logErr);
      }
    }

    return new Response(
      JSON.stringify({
        success: sentCount > 0,
        provider: providerUsed,
        sentCount,
        totalRecipients: recipients.length,
        errors: errors.length > 0 ? errors : undefined,
      }),
      { status: sentCount > 0 ? 200 : 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: any) {
    return new Response(
      JSON.stringify({ success: false, error: error?.message || "Internal server error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
