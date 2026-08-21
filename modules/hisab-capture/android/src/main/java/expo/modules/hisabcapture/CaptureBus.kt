package expo.modules.hisabcapture

object CaptureBus {
  @Volatile
  private var listener: ((Map<String, Any?>) -> Unit)? = null

  fun setListener(callback: ((Map<String, Any?>) -> Unit)?) {
    listener = callback
  }

  fun publish(payload: Map<String, Any?>) {
    listener?.invoke(payload)
  }

  fun hasListener(): Boolean = listener != null
}
