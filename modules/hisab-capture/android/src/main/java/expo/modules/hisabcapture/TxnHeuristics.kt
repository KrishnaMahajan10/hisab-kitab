package expo.modules.hisabcapture

object TxnHeuristics {
  private val AMOUNT = Regex(
    """(?:rs\.?|inr|₹)\s*([0-9][0-9,]*(?:\.[0-9]{1,2})?)""",
    RegexOption.IGNORE_CASE
  )

  private val MOVEMENT = Regex(
    """\b(debited|credited|spent|paid|withdrawn|received|purchase|txn|transaction|transfer|sent to|deducted)\b""",
    RegexOption.IGNORE_CASE
  )

  private val NOISE = Regex(
    """\b(otp|one[- ]time password|verification code|do not share|will expire|e-?mandate reminder|due on|statement is ready|offer|cashback offer|apply now|loan offer|pre-?approved)\b""",
    RegexOption.IGNORE_CASE
  )

  val PAYMENT_APPS = setOf(
    "com.google.android.apps.nbu.paisa.user",
    "com.phonepe.app",
    "com.phonepe.app.preprod",
    "net.one97.paytm",
    "in.org.npci.upiapp",
    "com.dreamplug.androidapp",
    "in.amazon.mShop.android.shopping",
    "com.mobikwik_new",
    "com.freecharge.android",
    "com.samsung.android.spay"
  )

  fun looksLikeTransaction(text: String): Boolean {
    if (text.isBlank()) return false
    if (NOISE.containsMatchIn(text)) return false
    return AMOUNT.containsMatchIn(text) && MOVEMENT.containsMatchIn(text)
  }
}
