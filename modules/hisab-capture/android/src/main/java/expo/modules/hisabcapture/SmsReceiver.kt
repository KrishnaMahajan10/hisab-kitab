package expo.modules.hisabcapture

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.provider.Telephony

class SmsReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    if (intent.action != Telephony.Sms.Intents.SMS_RECEIVED_ACTION) return

    val messages = runCatching { Telephony.Sms.Intents.getMessagesFromIntent(intent) }
      .getOrNull() ?: return

    val assembled = LinkedHashMap<String, StringBuilder>()
    var timestamp = System.currentTimeMillis()

    for (message in messages) {
      if (message == null) continue
      val sender = message.displayOriginatingAddress ?: message.originatingAddress ?: continue
      timestamp = message.timestampMillis
      assembled.getOrPut(sender) { StringBuilder() }.append(message.displayMessageBody ?: "")
    }

    val store = CaptureStore.get(context)
    var inserted = 0
    var preview: String? = null

    for ((sender, builder) in assembled) {
      val body = builder.toString().trim()
      if (!TxnHeuristics.looksLikeTransaction(body)) continue
      if (!store.insert("sms", sender, body, timestamp)) continue
      inserted++
      if (preview == null) preview = body.take(120)
      CaptureBus.publish(
        mapOf("source" to "sms", "sender" to sender, "body" to body, "postedAt" to timestamp)
      )
    }

    if (inserted > 0 && !CaptureBus.hasListener()) {
      CaptureNotifier.notifyPending(context, store.pendingCount(), preview)
    }
  }
}
