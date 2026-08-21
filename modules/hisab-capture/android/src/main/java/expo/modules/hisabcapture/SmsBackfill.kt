package expo.modules.hisabcapture

import android.content.Context
import android.provider.Telephony

object SmsBackfill {
  fun run(context: Context, sinceMs: Long, limit: Int): Int {
    val store = CaptureStore.get(context)
    var imported = 0

    val cursor = runCatching {
      context.contentResolver.query(
        Telephony.Sms.CONTENT_URI,
        arrayOf(Telephony.Sms.ADDRESS, Telephony.Sms.BODY, Telephony.Sms.DATE),
        "${Telephony.Sms.DATE} >= ?",
        arrayOf(sinceMs.toString()),
        "${Telephony.Sms.DATE} DESC LIMIT $limit"
      )
    }.getOrNull() ?: return 0

    cursor.use {
      while (it.moveToNext()) {
        val sender = it.getString(0) ?: continue
        val body = it.getString(1)?.trim() ?: continue
        val date = it.getLong(2)
        if (!TxnHeuristics.looksLikeTransaction(body)) continue
        if (store.insert("sms", sender, body, date)) imported++
      }
    }

    return imported
  }
}
