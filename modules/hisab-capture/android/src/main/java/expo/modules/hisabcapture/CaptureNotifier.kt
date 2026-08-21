package expo.modules.hisabcapture

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import androidx.core.app.NotificationCompat

object CaptureNotifier {
  private const val CHANNEL_ID = "hisab_capture"
  private const val NOTIFICATION_ID = 4711

  private fun ensureChannel(context: Context, manager: NotificationManager) {
    val existing = manager.getNotificationChannel(CHANNEL_ID)
    if (existing != null) return
    val channel = NotificationChannel(
      CHANNEL_ID,
      "Transactions to review",
      NotificationManager.IMPORTANCE_DEFAULT
    ).apply {
      description = "Prompts you to confirm captured transactions"
      setShowBadge(true)
    }
    manager.createNotificationChannel(channel)
  }

  fun notifyPending(context: Context, count: Int, preview: String?) {
    if (count <= 0) return
    val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as? NotificationManager
      ?: return
    ensureChannel(context, manager)

    val launch = context.packageManager.getLaunchIntentForPackage(context.packageName)
    val pending = launch?.let {
      PendingIntent.getActivity(
        context,
        0,
        it,
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
      )
    }

    val title = if (count == 1) "1 transaction to review" else "$count transactions to review"
    val builder = NotificationCompat.Builder(context, CHANNEL_ID)
      .setSmallIcon(android.R.drawable.ic_menu_agenda)
      .setContentTitle(title)
      .setAutoCancel(true)
      .setOnlyAlertOnce(true)

    if (!preview.isNullOrBlank()) {
      builder.setContentText(preview)
      builder.setStyle(NotificationCompat.BigTextStyle().bigText(preview))
    }
    if (pending != null) builder.setContentIntent(pending)

    runCatching { manager.notify(NOTIFICATION_ID, builder.build()) }
  }

  fun clear(context: Context) {
    val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as? NotificationManager
    manager?.cancel(NOTIFICATION_ID)
  }
}
