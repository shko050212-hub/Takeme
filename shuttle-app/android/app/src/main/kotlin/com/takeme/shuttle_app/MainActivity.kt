package com.takeme.shuttle_app

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Path
import android.graphics.PixelFormat
import android.graphics.RectF
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.net.Uri
import android.os.Build
import android.provider.Settings
import android.text.TextUtils
import android.util.TypedValue
import android.view.Gravity
import android.view.MotionEvent
import android.view.View
import android.view.WindowManager
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.TextView
import androidx.core.app.NotificationCompat
import io.flutter.embedding.android.FlutterActivity
import io.flutter.embedding.engine.FlutterEngine
import io.flutter.plugin.common.MethodChannel
import kotlin.math.abs

class MainActivity : FlutterActivity() {
    companion object {
        private const val CHANNEL = "com.takeme.shuttle_app/overlay"
        private const val NOTIF_CHANNEL_ID = "takeme_overlay_permission_channel"
        private const val NOTIF_ID = 4102
        private const val REQ_POST_NOTIF = 4103
    }

    private var windowManager: WindowManager? = null
    private var overlayView: View? = null
    private var overlayParams: WindowManager.LayoutParams? = null

    private var turn1IconView: ImageView? = null
    private var turn1DistView: TextView? = null
    private var turn1TextView: TextView? = null
    private var dividerView: View? = null
    private var turn2Row: LinearLayout? = null
    private var turn2IconView: ImageView? = null
    private var turn2DistView: TextView? = null

    private var isDriving = false
    private var turn1Dist = "직진"
    private var turn1Text = "경로를 따라 주행"
    private var turn1Type = "straight"
    private var turn2Dist = ""
    private var turn2Type = "straight"

    override fun configureFlutterEngine(flutterEngine: FlutterEngine) {
        super.configureFlutterEngine(flutterEngine)
        ensureNotificationChannel()

        MethodChannel(flutterEngine.dartExecutor.binaryMessenger, CHANNEL)
            .setMethodCallHandler { call, result ->
                when (call.method) {
                    "canDrawOverlays" -> {
                        result.success(canDrawOverlay())
                    }
                    "ensureOverlayPermission" -> {
                        requestNotificationPermissionIfNeeded()
                        val granted = canDrawOverlay()
                        if (!granted) {
                            sendOverlayPermissionNotification()
                        }
                        result.success(granted)
                    }
                    "openOverlaySettings" -> {
                        openOverlayPermissionSettings()
                        result.success(true)
                    }
                    "updateOverlay" -> {
                        isDriving = call.argument<Boolean>("driving") ?: false
                        turn1Dist = call.argument<String>("turn1Dist") ?: "직진"
                        turn1Text = call.argument<String>("turn1Text") ?: "경로를 따라 주행"
                        turn1Type = call.argument<String>("turn1Type") ?: "straight"
                        turn2Dist = call.argument<String>("turn2Dist") ?: ""
                        turn2Type = call.argument<String>("turn2Type") ?: "straight"

                        if (!isDriving) {
                            hideOverlayWindow()
                        } else {
                            refreshOverlayContent()
                        }
                        result.success(true)
                    }
                    "showOverlay" -> {
                        if (isDriving) {
                            if (canDrawOverlay()) {
                                showOverlayWindow()
                                result.success(true)
                            } else {
                                sendOverlayPermissionNotification()
                                result.success(false)
                            }
                        } else {
                            result.success(false)
                        }
                    }
                    "hideOverlay" -> {
                        hideOverlayWindow()
                        result.success(true)
                    }
                    else -> result.notImplemented()
                }
            }
    }

    override fun onUserLeaveHint() {
        super.onUserLeaveHint()
        handleBackgroundTransition()
    }

    override fun onStop() {
        super.onStop()
        handleBackgroundTransition()
    }

    override fun onResume() {
        super.onResume()
        hideOverlayWindow()
    }

    override fun onDestroy() {
        hideOverlayWindow()
        super.onDestroy()
    }

    private fun handleBackgroundTransition() {
        if (!isDriving) return
        if (canDrawOverlay()) {
            showOverlayWindow()
        } else {
            sendOverlayPermissionNotification()
        }
    }

    private fun canDrawOverlay(): Boolean {
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            Settings.canDrawOverlays(this)
        } else {
            true
        }
    }

    private fun requestNotificationPermissionIfNeeded() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            if (checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
                requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), REQ_POST_NOTIF)
            }
        }
    }

    private fun ensureNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val mgr = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            val channel = NotificationChannel(
                NOTIF_CHANNEL_ID,
                "다른 앱 위에 표시 권한 안내",
                NotificationManager.IMPORTANCE_HIGH
            ).apply {
                description = "백그라운드 주행 안내 오버레이 표시를 위한 권한 설정 알림"
                enableVibration(true)
            }
            mgr.createNotificationChannel(channel)
        }
    }

    private fun sendOverlayPermissionNotification() {
        ensureNotificationChannel()
        val intent = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            Intent(
                Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
                Uri.parse("package:$packageName")
            ).apply {
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            }
        } else {
            Intent(this, MainActivity::class.java)
        }

        val flags = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        } else {
            PendingIntent.FLAG_UPDATE_CURRENT
        }
        val pendingIntent = PendingIntent.getActivity(this, 0, intent, flags)

        val notification = NotificationCompat.Builder(this, NOTIF_CHANNEL_ID)
            .setSmallIcon(applicationInfo.icon)
            .setContentTitle("다른 앱 위에 표시 권한이 필요합니다")
            .setContentText("백그라운드에서도 파란 길 안내창을 띄우려면 터치하여 권한을 허용해 주세요.")
            .setStyle(
                NotificationCompat.BigTextStyle()
                    .bigText("백그라운드에서도 티맵처럼 다른 앱 위에 주행 길 안내창을 표시하려면 '다른 앱 위에 표시' 권한이 필요합니다. 터치하면 설정 화면으로 이동합니다.")
            )
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setCategory(NotificationCompat.CATEGORY_NAVIGATION)
            .setAutoCancel(true)
            .setContentIntent(pendingIntent)
            .build()

        val mgr = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        try {
            mgr.notify(NOTIF_ID, notification)
        } catch (_: SecurityException) {
            // POST_NOTIFICATIONS 미허용 시 예외 방지
        }
    }

    private fun openOverlayPermissionSettings() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            val intent = Intent(
                Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
                Uri.parse("package:$packageName")
            ).apply {
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            }
            startActivity(intent)
        }
    }

    private fun dp(value: Int): Int {
        return TypedValue.applyDimension(
            TypedValue.COMPLEX_UNIT_DIP,
            value.toFloat(),
            resources.displayMetrics
        ).toInt()
    }

    private fun showOverlayWindow() {
        if (!canDrawOverlay()) return
        if (overlayView != null) {
            refreshOverlayContent()
            return
        }

        val wm = getSystemService(Context.WINDOW_SERVICE) as WindowManager
        windowManager = wm

        // 티맵 미니 오버레이 크기 정도의 컴팩트한 파란색+흰색 2단 박스 (~172dp 폭)
        val cardWidth = dp(172)
        val radius = dp(14).toFloat()

        val root = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            layoutParams = LinearLayout.LayoutParams(cardWidth, LinearLayout.LayoutParams.WRAP_CONTENT)
            elevation = dp(10).toFloat()
        }

        // 1단 (주 회전 안내): 선명한 파란색 (#2563EB)
        val topBg = GradientDrawable().apply {
            shape = GradientDrawable.RECTANGLE
            setColor(Color.parseColor("#2563EB"))
            cornerRadii = floatArrayOf(radius, radius, radius, radius, 0f, 0f, 0f, 0f)
        }
        val topSingleBg = GradientDrawable().apply {
            shape = GradientDrawable.RECTANGLE
            setColor(Color.parseColor("#2563EB"))
            cornerRadius = radius
        }

        val topRow = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setPadding(dp(12), dp(10), dp(12), dp(10))
            background = if (turn2Dist.isNotEmpty()) topBg else topSingleBg
        }

        val icon1 = ImageView(this).apply {
            layoutParams = LinearLayout.LayoutParams(dp(38), dp(38))
            scaleType = ImageView.ScaleType.FIT_CENTER
        }
        turn1IconView = icon1
        topRow.addView(icon1)

        val textCol = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f).apply {
                marginStart = dp(10)
            }
        }

        val dist1 = TextView(this).apply {
            setTextColor(Color.WHITE)
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 22f)
            setTypeface(typeface, Typeface.BOLD)
            maxLines = 1
            includeFontPadding = false
        }
        turn1DistView = dist1
        textCol.addView(dist1)

        val road1 = TextView(this).apply {
            setTextColor(Color.parseColor("#F1F5F9"))
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 12f)
            setTypeface(typeface, Typeface.BOLD)
            maxLines = 1
            ellipsize = TextUtils.TruncateAt.END
            includeFontPadding = false
        }
        turn1TextView = road1
        textCol.addView(road1)

        topRow.addView(textCol)
        root.addView(topRow)

        // 구분선 (반투명 흰색)
        val div = View(this).apply {
            layoutParams = LinearLayout.LayoutParams(cardWidth, dp(1))
            setBackgroundColor(Color.parseColor("#40FFFFFF"))
        }
        dividerView = div
        root.addView(div)

        // 2단 (보조 회전 안내): 진한 파란색 (#1D4ED8)
        val bottomBg = GradientDrawable().apply {
            shape = GradientDrawable.RECTANGLE
            setColor(Color.parseColor("#1D4ED8"))
            cornerRadii = floatArrayOf(0f, 0f, 0f, 0f, radius, radius, radius, radius)
        }
        val bottomRow = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setPadding(dp(12), dp(7), dp(12), dp(8))
            background = bottomBg
        }
        turn2Row = bottomRow

        val icon2 = ImageView(this).apply {
            layoutParams = LinearLayout.LayoutParams(dp(20), dp(20))
            scaleType = ImageView.ScaleType.FIT_CENTER
        }
        turn2IconView = icon2
        bottomRow.addView(icon2)

        val dist2 = TextView(this).apply {
            layoutParams = LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.WRAP_CONTENT,
                LinearLayout.LayoutParams.WRAP_CONTENT
            ).apply {
                marginStart = dp(8)
            }
            setTextColor(Color.WHITE)
            setTextSize(TypedValue.COMPLEX_UNIT_SP, 15f)
            setTypeface(typeface, Typeface.BOLD)
            maxLines = 1
            includeFontPadding = false
        }
        turn2DistView = dist2
        bottomRow.addView(dist2)

        root.addView(bottomRow)

        val windowType = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY
        } else {
            @Suppress("DEPRECATION")
            WindowManager.LayoutParams.TYPE_PHONE
        }

        val params = WindowManager.LayoutParams(
            cardWidth,
            WindowManager.LayoutParams.WRAP_CONTENT,
            windowType,
            WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE or WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN,
            PixelFormat.TRANSLUCENT
        ).apply {
            gravity = Gravity.TOP or Gravity.START
            x = dp(18)
            y = dp(110)
        }
        overlayParams = params

        // 드래그 이동 + 터치 시 앱 복귀
        var startX = 0
        var startY = 0
        var touchX = 0f
        var touchY = 0f
        var moved = false
        val slop = dp(8)

        root.setOnTouchListener { _, event ->
            when (event.actionMasked) {
                MotionEvent.ACTION_DOWN -> {
                    startX = params.x
                    startY = params.y
                    touchX = event.rawX
                    touchY = event.rawY
                    moved = false
                    true
                }
                MotionEvent.ACTION_MOVE -> {
                    val dx = (event.rawX - touchX).toInt()
                    val dy = (event.rawY - touchY).toInt()
                    if (abs(dx) > slop || abs(dy) > slop) {
                        moved = true
                    }
                    if (moved && overlayView != null) {
                        params.x = startX + dx
                        params.y = startY + dy
                        try {
                            wm.updateViewLayout(overlayView, params)
                        } catch (_: Exception) {}
                    }
                    true
                }
                MotionEvent.ACTION_UP -> {
                    if (!moved) {
                        val launchIntent = Intent(this@MainActivity, MainActivity::class.java).apply {
                            addFlags(
                                Intent.FLAG_ACTIVITY_NEW_TASK or
                                    Intent.FLAG_ACTIVITY_SINGLE_TOP or
                                    Intent.FLAG_ACTIVITY_CLEAR_TOP
                            )
                        }
                        startActivity(launchIntent)
                        hideOverlayWindow()
                    }
                    true
                }
                else -> false
            }
        }

        overlayView = root
        refreshOverlayContent()

        try {
            wm.addView(root, params)
        } catch (_: Exception) {
            overlayView = null
        }
    }

    private fun refreshOverlayContent() {
        val root = overlayView as? LinearLayout ?: return
        val topRow = root.getChildAt(0) as? LinearLayout ?: return
        val radius = dp(14).toFloat()

        turn1DistView?.text = turn1Dist
        turn1TextView?.text = turn1Text
        turn1IconView?.setImageBitmap(drawTurnArrowBitmap(turn1Type, dp(38)))

        val hasSecond = turn2Dist.isNotEmpty()
        dividerView?.visibility = if (hasSecond) View.VISIBLE else View.GONE
        turn2Row?.visibility = if (hasSecond) View.VISIBLE else View.GONE

        val topBg = GradientDrawable().apply {
            shape = GradientDrawable.RECTANGLE
            setColor(Color.parseColor("#2563EB"))
            if (hasSecond) {
                cornerRadii = floatArrayOf(radius, radius, radius, radius, 0f, 0f, 0f, 0f)
            } else {
                cornerRadius = radius
            }
        }
        topRow.background = topBg

        if (hasSecond) {
            turn2DistView?.text = turn2Dist
            turn2IconView?.setImageBitmap(drawTurnArrowBitmap(turn2Type, dp(20)))
        }
    }

    private fun hideOverlayWindow() {
        val view = overlayView ?: return
        try {
            windowManager?.removeView(view)
        } catch (_: Exception) {}
        overlayView = null
    }

    /**
     * 파란 배경 위에 선명하게 보이는 흰색 회전 화살표 비트맵 생성
     */
    private fun drawTurnArrowBitmap(type: String, sizePx: Int): Bitmap {
        val s = sizePx.coerceAtLeast(24)
        val bmp = Bitmap.createBitmap(s, s, Bitmap.Config.ARGB_8888)
        val canvas = Canvas(bmp)
        val w = s.toFloat()
        val stroke = (w * 0.14f).coerceAtLeast(3.5f)

        val paint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = Color.WHITE
            style = Paint.Style.STROKE
            strokeWidth = stroke
            strokeCap = Paint.Cap.ROUND
            strokeJoin = Paint.Join.ROUND
        }
        val fillPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply {
            color = Color.WHITE
            style = Paint.Style.FILL
        }

        fun drawArrowHead(tipX: Float, tipY: Float, dirX: Float, dirY: Float) {
            val len = kotlin.math.hypot(dirX.toDouble(), dirY.toDouble()).toFloat().coerceAtLeast(0.001f)
            val ux = dirX / len
            val uy = dirY / len
            val px = -uy
            val py = ux
            val headLen = w * 0.28f
            val headHalfWidth = w * 0.21f
            val bx = tipX - ux * headLen
            val by = tipY - uy * headLen
            val head = Path().apply {
                moveTo(tipX, tipY)
                lineTo(bx + px * headHalfWidth, by + py * headHalfWidth)
                lineTo(bx - px * headHalfWidth, by - py * headHalfWidth)
                close()
            }
            canvas.drawPath(head, fillPaint)
        }

        val path = Path()
        when (type) {
            "left" -> {
                // 아래에서 올라오다가 왼쪽으로 꺾는 화살표 (↰)
                path.moveTo(w * 0.66f, w * 0.86f)
                path.lineTo(w * 0.66f, w * 0.46f)
                path.quadTo(w * 0.66f, w * 0.34f, w * 0.54f, w * 0.34f)
                path.lineTo(w * 0.28f, w * 0.34f)
                canvas.drawPath(path, paint)
                drawArrowHead(w * 0.14f, w * 0.34f, -1f, 0f)
            }
            "right" -> {
                // 아래에서 올라오다가 오른쪽으로 꺾는 화살표 (↱)
                path.moveTo(w * 0.34f, w * 0.86f)
                path.lineTo(w * 0.34f, w * 0.46f)
                path.quadTo(w * 0.34f, w * 0.34f, w * 0.46f, w * 0.34f)
                path.lineTo(w * 0.72f, w * 0.34f)
                canvas.drawPath(path, paint)
                drawArrowHead(w * 0.86f, w * 0.34f, 1f, 0f)
            }
            "slight_left" -> {
                path.moveTo(w * 0.62f, w * 0.86f)
                path.lineTo(w * 0.62f, w * 0.54f)
                path.lineTo(w * 0.32f, w * 0.24f)
                canvas.drawPath(path, paint)
                drawArrowHead(w * 0.20f, w * 0.12f, -1f, -1f)
            }
            "slight_right" -> {
                path.moveTo(w * 0.38f, w * 0.86f)
                path.lineTo(w * 0.38f, w * 0.54f)
                path.lineTo(w * 0.68f, w * 0.24f)
                canvas.drawPath(path, paint)
                drawArrowHead(w * 0.80f, w * 0.12f, 1f, -1f)
            }
            "uturn" -> {
                path.moveTo(w * 0.68f, w * 0.86f)
                path.lineTo(w * 0.68f, w * 0.40f)
                path.arcTo(RectF(w * 0.28f, w * 0.18f, w * 0.68f, w * 0.56f), 0f, -180f, false)
                path.lineTo(w * 0.28f, w * 0.68f)
                canvas.drawPath(path, paint)
                drawArrowHead(w * 0.28f, w * 0.84f, 0f, 1f)
            }
            "goal" -> {
                canvas.drawCircle(w * 0.5f, w * 0.5f, w * 0.30f, paint)
                canvas.drawCircle(w * 0.5f, w * 0.5f, w * 0.12f, fillPaint)
            }
            else -> {
                // 직진 (↑)
                path.moveTo(w * 0.5f, w * 0.86f)
                path.lineTo(w * 0.5f, w * 0.28f)
                canvas.drawPath(path, paint)
                drawArrowHead(w * 0.5f, w * 0.12f, 0f, -1f)
            }
        }
        return bmp
    }
}
