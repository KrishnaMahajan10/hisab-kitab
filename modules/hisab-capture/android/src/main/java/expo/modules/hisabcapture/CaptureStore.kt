package expo.modules.hisabcapture

import android.content.ContentValues
import android.content.Context
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteOpenHelper

data class Capture(
  val id: Long,
  val source: String,
  val sender: String,
  val body: String,
  val postedAt: Long
) {
  fun toMap(): Map<String, Any?> = mapOf(
    "id" to id,
    "source" to source,
    "sender" to sender,
    "body" to body,
    "postedAt" to postedAt
  )
}

class CaptureStore private constructor(context: Context) :
  SQLiteOpenHelper(context.applicationContext, DB_NAME, null, DB_VERSION) {

  override fun onCreate(db: SQLiteDatabase) {
    db.execSQL(
      """
      CREATE TABLE captures (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        source TEXT NOT NULL,
        sender TEXT NOT NULL,
        body TEXT NOT NULL,
        posted_at INTEGER NOT NULL,
        dedup_key TEXT NOT NULL UNIQUE,
        consumed INTEGER NOT NULL DEFAULT 0
      )
      """.trimIndent()
    )
    db.execSQL("CREATE INDEX idx_captures_pending ON captures (consumed, posted_at)")
  }

  override fun onUpgrade(db: SQLiteDatabase, oldVersion: Int, newVersion: Int) = Unit

  fun insert(source: String, sender: String, body: String, postedAt: Long): Boolean {
    val values = ContentValues().apply {
      put("source", source)
      put("sender", sender)
      put("body", body)
      put("posted_at", postedAt)
      put("dedup_key", "$source|$sender|$body|${postedAt / DEDUP_WINDOW_MS}")
    }
    val rowId = writableDatabase.insertWithOnConflict(
      "captures", null, values, SQLiteDatabase.CONFLICT_IGNORE
    )
    return rowId != -1L
  }

  fun pending(limit: Int): List<Capture> {
    val out = mutableListOf<Capture>()
    readableDatabase.query(
      "captures",
      arrayOf("id", "source", "sender", "body", "posted_at"),
      "consumed = 0",
      null,
      null,
      null,
      "posted_at DESC",
      limit.toString()
    ).use { cursor ->
      while (cursor.moveToNext()) {
        out.add(
          Capture(
            id = cursor.getLong(0),
            source = cursor.getString(1),
            sender = cursor.getString(2),
            body = cursor.getString(3),
            postedAt = cursor.getLong(4)
          )
        )
      }
    }
    return out
  }

  fun pendingCount(): Int {
    readableDatabase.rawQuery("SELECT COUNT(*) FROM captures WHERE consumed = 0", null).use {
      return if (it.moveToFirst()) it.getInt(0) else 0
    }
  }

  fun markConsumed(ids: List<Long>) {
    if (ids.isEmpty()) return
    val placeholders = ids.joinToString(",") { "?" }
    writableDatabase.execSQL(
      "UPDATE captures SET consumed = 1 WHERE id IN ($placeholders)",
      ids.map { it.toString() }.toTypedArray()
    )
  }

  companion object {
    private const val DB_NAME = "hisab_capture_queue.db"
    private const val DB_VERSION = 1
    private const val DEDUP_WINDOW_MS = 60_000L

    @Volatile
    private var instance: CaptureStore? = null

    fun get(context: Context): CaptureStore =
      instance ?: synchronized(this) {
        instance ?: CaptureStore(context).also { instance = it }
      }
  }
}
