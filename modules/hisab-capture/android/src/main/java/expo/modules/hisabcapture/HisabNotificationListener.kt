package expo.modules.hisabcapture

import android.app.Notification
import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification

class HisabNotificationListener : NotificationListenerService() {

  override fun onNotificationPosted(sbn: StatusBarNotification?) {
    val notification = sbn ?: return
    val packageName = notification.packageName ?: return
    if (packageName == applicationContext.packageName) return
    if (packageName !in TxnHeuristics.PAYMENT_APPS) return

    val extras = notification.notification?.extras ?: return
    val title = extras.getCharSequence(Notification.EXTRA_TITLE)?.toString()?.trim().orEmpty()
    val big = extras.getCharSequence(Notification.EXTRA_BIG_TEXT)?.toString()?.trim().orEmpty()
    val text = extras.getCharSequence(Notification.EXTRA_TEXT)?.toString()?.trim().orEmpty()

    val body = listOf(title, big.ifBlank { text })
      .filter { it.isNotBlank() }
      .distinct()
      .joinToString(" — ")

    if (!TxnHeuristics.looksLikeTransaction(body)) return

    val postedAt = if (notification.postTime > 0) notification.postTime else System.currentTimeMillis()
    val store = CaptureStore.get(applicationContext)
    if (!store.insert("notification", packageName, body, postedAt)) return

    CaptureBus.publish(
      mapOf(
        "source" to "notification",
        "sender" to packageName,
        "body" to body,
        "postedAt" to postedAt
      )
    )

    if (!CaptureBus.hasListener()) {
      CaptureNotifier.notifyPending(applicationContext, store.pendingCount(), body.take(120))
    }
  }

  override fun onNotificationRemoved(sbn: StatusBarNotification?) = Unit
}
