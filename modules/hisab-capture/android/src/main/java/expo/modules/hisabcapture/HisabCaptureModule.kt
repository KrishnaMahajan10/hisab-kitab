package expo.modules.hisabcapture

import android.Manifest
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.provider.Settings
import androidx.core.content.ContextCompat
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class HisabCaptureModule : Module() {

  private val context: Context
    get() = appContext.reactContext ?: throw Exceptions.ReactContextLost()

  override fun definition() = ModuleDefinition {
    Name("HisabCapture")

    Events("onCapture")

    OnStartObserving("onCapture") {
      CaptureBus.setListener { payload -> sendEvent("onCapture", payload) }
      CaptureNotifier.clear(context)
    }

    OnStopObserving("onCapture") {
      CaptureBus.setListener(null)
    }

    Function("hasSmsPermission") {
      ContextCompat.checkSelfPermission(context, Manifest.permission.READ_SMS) ==
        PackageManager.PERMISSION_GRANTED &&
        ContextCompat.checkSelfPermission(context, Manifest.permission.RECEIVE_SMS) ==
        PackageManager.PERMISSION_GRANTED
    }

    Function("isNotificationAccessGranted") {
      val enabled = Settings.Secure.getString(
        context.contentResolver,
        "enabled_notification_listeners"
      ).orEmpty()
      enabled.contains(context.packageName)
    }

    Function("openNotificationAccessSettings") {
      val intent = Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS)
        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      context.startActivity(intent)
    }

    Function("pendingCount") {
      CaptureStore.get(context).pendingCount()
    }

    AsyncFunction("getPendingCaptures") { limit: Int ->
      CaptureStore.get(context).pending(limit).map { it.toMap() }
    }

    AsyncFunction("markConsumed") { ids: List<Double> ->
      CaptureStore.get(context).markConsumed(ids.map { it.toLong() })
    }

    AsyncFunction("backfillSms") { sinceMs: Double, limit: Int ->
      SmsBackfill.run(context, sinceMs.toLong(), limit)
    }

    Function("clearCaptureNotification") {
      CaptureNotifier.clear(context)
    }

    AsyncFunction("extractPdfText") { uri: String, password: String? ->
      PdfTextExtractor.extract(context, uri, password)
    }
  }
}
