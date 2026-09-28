package id.znetworks.nexus.feature.attendance.history

import android.content.Context
import android.graphics.Color as AColor
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.viewinterop.AndroidView
import org.osmdroid.config.Configuration
import org.osmdroid.tileprovider.tilesource.TileSourceFactory
import org.osmdroid.util.BoundingBox
import org.osmdroid.util.GeoPoint
import org.osmdroid.views.MapView
import org.osmdroid.views.overlay.Marker
import org.osmdroid.views.overlay.Polygon
import org.osmdroid.views.overlay.Polyline
import java.io.File

/** OpenStreetMap, the same tiles as the web (Leaflet, tile.openstreetmap.org). */
object OsmSetup {
    @Volatile private var done = false
    fun ensure(context: Context) {
        if (done) return
        Configuration.getInstance().apply {
            // OSM's tile policy asks for an identifying user agent.
            userAgentValue = "NEXUS-Android (${context.packageName})"
            osmdroidBasePath = File(context.cacheDir, "osmdroid")
            osmdroidTileCache = File(context.cacheDir, "osmdroid/tiles")
        }
        done = true
    }
}

data class MapCircle(val lat: Double, val lng: Double, val radius: Double)
data class MapPin(val lat: Double, val lng: Double, val title: String)

/** A static map: office circle, a path, and pins. Interaction is pan/zoom only. */
@Composable
fun OsmMap(
    modifier: Modifier,
    circle: MapCircle?,
    path: List<Pair<Double, Double>>,
    pins: List<MapPin>,
    pathColor: Int = AColor.parseColor("#7B68EE"),
    /** Faint dots off the line: the hourly presence checks made inside the office. */
    dots: List<Pair<Double, Double>> = emptyList(),
) {
    val context = LocalContext.current
    OsmSetup.ensure(context)
    val map = remember {
        MapView(context).apply {
            setTileSource(TileSourceFactory.MAPNIK)
            setMultiTouchControls(true)
            zoomController.setVisibility(org.osmdroid.views.CustomZoomButtonsController.Visibility.NEVER)
        }
    }
    DisposableEffect(map) {
        map.onResume()
        onDispose { map.onPause(); map.onDetach() }
    }
    AndroidView({ map }, modifier) { m ->
        m.overlays.clear()
        val all = mutableListOf<GeoPoint>()
        circle?.let {
            val center = GeoPoint(it.lat, it.lng)
            m.overlays += Polygon(m).apply {
                points = Polygon.pointsAsCircle(center, it.radius)
                fillPaint.color = AColor.argb(40, 16, 185, 129)
                outlinePaint.color = AColor.argb(200, 16, 185, 129)
                outlinePaint.strokeWidth = 3f
            }
            all += center
        }
        if (path.size >= 2) {
            m.overlays += Polyline(m).apply {
                setPoints(path.map { GeoPoint(it.first, it.second) })
                outlinePaint.color = pathColor
                outlinePaint.strokeWidth = 6f
            }
        }
        path.forEach { all += GeoPoint(it.first, it.second) }
        dots.forEach { d ->
            m.overlays += Polygon(m).apply {
                points = Polygon.pointsAsCircle(GeoPoint(d.first, d.second), 5.0)
                fillPaint.color = AColor.argb(115, 16, 185, 129)
                outlinePaint.color = AColor.argb(200, 255, 255, 255)
                outlinePaint.strokeWidth = 2f
            }
        }
        pins.forEach { p ->
            m.overlays += Marker(m).apply {
                position = GeoPoint(p.lat, p.lng)
                title = p.title
                setAnchor(Marker.ANCHOR_CENTER, Marker.ANCHOR_BOTTOM)
            }
            all += GeoPoint(p.lat, p.lng)
        }
        m.post {
            when {
                all.size >= 2 -> m.zoomToBoundingBox(BoundingBox.fromGeoPoints(all).increaseByScale(1.4f), false)
                all.size == 1 -> { m.controller.setZoom(17.0); m.controller.setCenter(all.first()) }
                else -> { m.controller.setZoom(11.0); m.controller.setCenter(GeoPoint(-6.2, 106.82)) }
            }
        }
        m.invalidate()
    }
}
