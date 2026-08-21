package expo.modules.hisabcapture

import android.content.Context
import android.net.Uri
import com.tom_roush.pdfbox.android.PDFBoxResourceLoader
import com.tom_roush.pdfbox.pdmodel.PDDocument
import com.tom_roush.pdfbox.pdmodel.encryption.InvalidPasswordException
import com.tom_roush.pdfbox.text.PDFTextStripper

object PdfTextExtractor {
  @Volatile
  private var initialized = false

  private fun ensureInitialized(context: Context) {
    if (initialized) return
    synchronized(this) {
      if (!initialized) {
        PDFBoxResourceLoader.init(context.applicationContext)
        initialized = true
      }
    }
  }

  fun extract(context: Context, uriString: String, password: String?): Map<String, Any?> {
    ensureInitialized(context)

    val uri = runCatching { Uri.parse(uriString) }.getOrNull()
      ?: return failure("io", "Could not understand the file location")

    val stream = runCatching { context.contentResolver.openInputStream(uri) }.getOrNull()
      ?: return failure("io", "Could not open the file")

    return stream.use { input ->
      try {
        val document = PDDocument.load(input, password ?: "")
        document.use { doc ->
          if (doc.isEncrypted) {
            runCatching { doc.setAllSecurityToBeRemoved(true) }
          }
          val stripper = PDFTextStripper().apply { sortByPosition = true }
          val text = stripper.getText(doc)
          mapOf(
            "ok" to true,
            "text" to text,
            "pageCount" to doc.numberOfPages,
            "error" to null,
            "message" to null
          )
        }
      } catch (error: InvalidPasswordException) {
        failure("password", "This PDF needs a password")
      } catch (error: OutOfMemoryError) {
        failure("memory", "The PDF is too large to read on this device")
      } catch (error: Exception) {
        failure("parse", error.message ?: "Could not read the PDF")
      }
    }
  }

  private fun failure(code: String, message: String): Map<String, Any?> =
    mapOf("ok" to false, "text" to null, "pageCount" to 0, "error" to code, "message" to message)
}
