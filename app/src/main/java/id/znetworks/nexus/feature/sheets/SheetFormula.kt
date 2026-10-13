package id.znetworks.nexus.feature.sheets

import java.math.BigDecimal
import java.math.RoundingMode
import java.time.LocalDate
import kotlin.math.floor

/**
 * The parts of the web's spreadsheet engine the phone needs (dev web lib/sheet-formula.ts, 13 Oct 2026), ported
 * line for line: Indonesian number/date parsing, A1 <-> stored references, separators, and the display formats
 * used for a cell edited here and not yet re-read from the server. There is NO formula evaluator: the server's
 * `?computed=1` gives every value. [en] is the sheet's display locale (`settings.locale == "en-US"`).
 */
object SheetFormula {
    const val REF_ERROR = "#REF!"
    private const val AMBIGUOUS = "=?"

    // region Dates (serials, Asia/Jakarta)

    private val EPOCH: Long = LocalDate.of(1899, 12, 30).toEpochDay()

    fun ymdToSerial(y: Int, m: Int, d: Int): Int = (LocalDate.of(y, m, d).toEpochDay() - EPOCH).toInt()
    fun serialToDate(serial: Double): LocalDate = LocalDate.ofEpochDay(EPOCH + floor(serial).toLong())
    fun serialToIso(serial: Double): String = serialToDate(serial).toString()

    private fun daysIn(y: Int, m: Int) = java.time.YearMonth.of(y, m).lengthOfMonth()
    private fun validYmd(y: Int, m: Int, d: Int) = y in 1900..9999 && m in 1..12 && d >= 1 && d <= daysIn(y, m)

    /** "2026-10-11" -> serial; anything else -> null. */
    fun isoToSerial(s: String?): Int? {
        val m = Regex("^(\\d{4})-(\\d{1,2})-(\\d{1,2})$").matchEntire(s?.trim() ?: return null) ?: return null
        val y = m.groupValues[1].toInt(); val mo = m.groupValues[2].toInt(); val d = m.groupValues[3].toInt()
        return if (validYmd(y, mo, d)) ymdToSerial(y, mo, d) else null
    }

    private val MONTHS = mapOf(
        "jan" to 1, "januari" to 1, "january" to 1, "feb" to 2, "februari" to 2, "february" to 2, "peb" to 2,
        "mar" to 3, "maret" to 3, "march" to 3, "apr" to 4, "april" to 4, "mei" to 5, "may" to 5,
        "jun" to 6, "juni" to 6, "june" to 6, "jul" to 7, "juli" to 7, "july" to 7,
        "agu" to 8, "agt" to 8, "ags" to 8, "agustus" to 8, "aug" to 8, "august" to 8,
        "sep" to 9, "sept" to 9, "september" to 9, "okt" to 10, "oktober" to 10, "oct" to 10, "october" to 10,
        "nov" to 11, "nop" to 11, "november" to 11, "nopember" to 11, "des" to 12, "desember" to 12, "dec" to 12, "december" to 12,
    )
    private val MONTH_SHORT_ID = listOf("Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des")
    private val MONTH_SHORT_EN = listOf("Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec")

    /** A date as Indonesians type it (day FIRST; month first in en-US), to a serial; null when not a real date. */
    fun parseDateText(raw: String, en: Boolean = false): Int? {
        val s = raw.trim()
        isoToSerial(s)?.let { return it }
        Regex("^(\\d{1,2})[/\\-.](\\d{1,2})[/\\-.](\\d{4}|\\d{2})$").matchEntire(s)?.let { m ->
            val d = (if (en) m.groupValues[2] else m.groupValues[1]).toInt()
            val mo = (if (en) m.groupValues[1] else m.groupValues[2]).toInt()
            var y = m.groupValues[3].toInt()
            if (m.groupValues[3].length == 2) y += 2000
            return if (validYmd(y, mo, d)) ymdToSerial(y, mo, d) else null
        }
        Regex("^(\\d{1,2})\\s+([A-Za-z]+)\\.?,?\\s+(\\d{4})$").matchEntire(s)?.let { m ->
            val d = m.groupValues[1].toInt(); val mo = MONTHS[m.groupValues[2].lowercase()]; val y = m.groupValues[3].toInt()
            return if (mo != null && validYmd(y, mo, d)) ymdToSerial(y, mo, d) else null
        }
        Regex("^([A-Za-z]+)\\.?\\s+(\\d{1,2}),?\\s+(\\d{4})$").matchEntire(s)?.let { m ->
            val mo = MONTHS[m.groupValues[1].lowercase()]; val d = m.groupValues[2].toInt(); val y = m.groupValues[3].toInt()
            return if (mo != null && validYmd(y, mo, d)) ymdToSerial(y, mo, d) else null
        }
        return null
    }

    // endregion

    // region Numbers as typed in Indonesia

    private fun groupMark(en: Boolean) = if (en) "," else "."
    private fun decimalMark(en: Boolean) = if (en) "." else ","

    private fun validGrouping(x: String, g: String): Boolean {
        val parts = x.split(g)
        if (!Regex("^\\d{1,3}$").matches(parts[0])) return false
        return parts.drop(1).all { Regex("^\\d{3}$").matches(it) }
    }

    data class ParsedNumber(val n: Double, val separators: Boolean)

    /** "1.500.000" -> 1500000, "1,5" -> 1.5, "1.500" -> 1500, "1.5" -> 1.5, "1,500,000.50" -> 1500000.5, "(250)" -> -250. */
    fun parseLocaleNumber(raw: String, en: Boolean = false): ParsedNumber? {
        var s = raw.trim()
        if (s.isEmpty()) return null
        var neg = false
        if (Regex("^\\(.*\\)$").matches(s)) { neg = true; s = s.substring(1, s.length - 1).trim() }
        if (s.startsWith("-")) { neg = !neg; s = s.substring(1).trim() }
        else if (s.startsWith("+")) s = s.substring(1).trim()
        if (!Regex("^(\\d[\\d.,]*|[.,]\\d+)$").matches(s)) return null
        if (s.endsWith(".") || s.endsWith(",")) return null
        val dots = s.count { it == '.' }
        val commas = s.count { it == ',' }
        var intPart = s
        var frac = ""
        if (dots > 0 && commas > 0) {
            val dec = if (s.lastIndexOf('.') > s.lastIndexOf(',')) "." else ","
            val grp = if (dec == ".") "," else "."
            val parts = s.split(dec)
            if (parts.size != 2) return null
            if (!validGrouping(parts[0], grp)) return null
            intPart = parts[0].split(grp).joinToString("")
            frac = parts[1]
        } else if (dots > 0 || commas > 0) {
            val ch = if (dots > 0) "." else ","
            val parts = s.split(ch)
            if (parts.size > 2) {
                if (!validGrouping(s, ch)) return null
                intPart = parts.joinToString("")
            } else {
                val a = parts[0]; val b = parts[1]
                // A lone grouping mark ("." in id-ID, "," in en-US) groups only when exactly three digits follow.
                val looksGrouped = ch == groupMark(en) && b.length == 3 && Regex("^[1-9]\\d{0,2}$").matches(a)
                if (looksGrouped) intPart = a + b else { intPart = a; frac = b }
            }
        }
        if (!Regex("^\\d*$").matches(intPart) || !Regex("^\\d*$").matches(frac) || (intPart + frac).isEmpty()) return null
        val n = "${intPart.ifEmpty { "0" }}.${frac.ifEmpty { "0" }}".toDoubleOrNull() ?: return null
        if (!n.isFinite()) return null
        return ParsedNumber(if (neg) -n else n, dots + commas > 0)
    }

    /** What a piece of typed text IS (web Detected). */
    sealed interface Detected {
        data object Empty : Detected
        data class Text(val v: String) : Detected
        /** [nf] = "num" | "idr" | "pct" | "date" | null. */
        data class Number(val v: Double, val nf: String?) : Detected
    }

    /** Leading zero, leading "+", more than 15 digits or 40 chars stay text: a number would lose information. */
    fun detectInput(text: String, en: Boolean = false): Detected {
        val s = text.trim()
        if (s.isEmpty()) return Detected.Empty
        if (s.length > 40) return Detected.Text(text)
        val digits = s.count { it.isDigit() }
        if (digits == 0) return Detected.Text(text)
        if (s.startsWith("+")) return Detected.Text(text)
        Regex("^(.*?)\\s*%$").matchEntire(s)?.let { m ->
            val p = parseLocaleNumber(m.groupValues[1], en)
            return if (p != null) Detected.Number(p.n / 100, "pct") else Detected.Text(text)
        }
        Regex("^(-?)\\s*(?:rp\\.?|idr)\\s*(-?)\\s*([\\d.,]+?)(?:,-)?$", RegexOption.IGNORE_CASE).matchEntire(s)?.let { m ->
            val p = parseLocaleNumber(m.groupValues[3], en) ?: return Detected.Text(text)
            val neg = (m.groupValues[1] == "-") != (m.groupValues[2] == "-")
            return Detected.Number(if (neg) -p.n else p.n, "idr")
        }
        parseDateText(s, en)?.let { return Detected.Number(it.toDouble(), "date") }
        val p = parseLocaleNumber(s, en) ?: return Detected.Text(text)
        val bare = s.replace(Regex("^[-(]+|\\)$"), "")
        if (Regex("^0\\d").containsMatchIn(bare)) return Detected.Text(text)
        if (digits > 15) return Detected.Text(text)
        return Detected.Number(p.n, if (p.separators) "num" else null)
    }

    // endregion

    // region Display formatting (for a cell not yet re-read from the server)

    /** Intl.NumberFormat(locale, {maximumFractionDigits, useGrouping}) with half-away-from-zero rounding. */
    fun numberText(n: Double, maxFrac: Int, grouping: Boolean, en: Boolean, minFrac: Int = 0): String {
        if (!n.isFinite()) return "#NUM!"
        var bd = BigDecimal(n.toString()).setScale(maxFrac, RoundingMode.HALF_UP).stripTrailingZeros()
        if (bd.scale() < minFrac) bd = bd.setScale(minFrac)
        if (bd.signum() == 0) bd = BigDecimal.ZERO.setScale(minFrac.coerceAtLeast(0))
        val neg = bd.signum() < 0
        val plain = bd.abs().toPlainString()
        val intPart = plain.substringBefore('.')
        val frac = if (plain.contains('.')) plain.substringAfter('.') else ""
        val grouped = if (grouping) intPart.reversed().chunked(3).joinToString(groupMark(en)).reversed() else intPart
        return (if (neg) "-" else "") + grouped + (if (frac.isNotEmpty()) decimalMark(en) + frac else "")
    }

    fun formatRupiah(n: Double, en: Boolean = false) = "Rp " + numberText(n, 2, true, en)
    fun formatGrouped(n: Double, maxFrac: Int = 2, en: Boolean = false) = numberText(n, maxFrac, true, en)

    /** "11 Okt 2026" ("Oct 11, 2026" in en-US). */
    fun formatDateSerial(serial: Double, en: Boolean = false): String {
        val d = serialToDate(serial)
        return if (en) "${MONTH_SHORT_EN[d.monthValue - 1]} ${d.dayOfMonth}, ${d.year}"
        else "${d.dayOfMonth.toString().padStart(2, '0')} ${MONTH_SHORT_ID[d.monthValue - 1]} ${d.year}"
    }

    /** What a date is edited as: day first ("11/10/2026"; en-US "10/11/2026"). */
    fun editDateSerial(serial: Double, en: Boolean = false): String {
        val d = serialToDate(serial)
        return if (en) "${d.monthValue}/${d.dayOfMonth}/${d.year}"
        else "${d.dayOfMonth.toString().padStart(2, '0')}/${d.monthValue.toString().padStart(2, '0')}/${d.year}"
    }

    /** A number with an explicit format (web formatValue); [nf] null = General. */
    fun formatNumber(v: Double, nf: String?, en: Boolean = false): String = when (nf) {
        "idr" -> formatRupiah(v, en)
        "num" -> formatGrouped(v, 6, en)
        "pct" -> numberText(v * 100, 4, true, en) + "%"
        "date" -> editDateSerial(v, en)
        else -> numberText(v, 10, false, en)
    }

    /** The text a typed `{v, nf}` cell is edited as: re-parsing it gives the same value back. */
    fun editTyped(v: Double, nf: String, en: Boolean = false): String = when (nf) {
        "idr" -> formatRupiah(v, en)
        "num" -> formatGrouped(v, 10, en)
        "pct" -> numberText(v * 100, 10, true, en) + "%"
        "date" -> editDateSerial(v, en)
        else -> numberText(v, 10, false, en)
    }

    // endregion

    // region A1 <-> index, A1 <-> stored

    fun colLetter(index: Int): String {
        var n = index
        val out = StringBuilder()
        do { out.insert(0, ('A' + (n % 26))); n = n / 26 - 1 } while (n >= 0)
        return out.toString()
    }

    fun letterToIndex(letters: String): Int {
        var n = 0
        for (ch in letters.uppercase()) n = n * 26 + (ch - 'A' + 1)
        return n - 1
    }

    /** Column and row ids in display order (hidden ones included). */
    data class Shape(val columnIds: List<String>, val rowIds: List<String>)

    sealed interface A1Ref {
        val col: Int
        val absCol: Boolean
        data class Cell(override val col: Int, val row: Int, override val absCol: Boolean, val absRow: Boolean) : A1Ref
        data class Col(override val col: Int, override val absCol: Boolean) : A1Ref
    }

    private val CELL_RE = Regex("^(\\$?)([A-Za-z]{1,3})(\\$?)(\\d+)$")
    private val COL_RE = Regex("^(\\$?)([A-Za-z]{1,3})$")
    private fun identCh(c: Char) = c.asciiLetter() || c.asciiDigit() || c == '_' || c == '.' || c == '$'
    private fun Char.asciiLetter() = this in 'A'..'Z' || this in 'a'..'z'
    private fun Char.asciiDigit() = this in '0'..'9'

    /** Walk an A1 formula and let [fn] rewrite every reference (strings, function names and stored refs skipped). */
    fun mapA1Refs(formula: String, fn: (A1Ref, String) -> String?): String {
        val out = StringBuilder()
        var i = 0
        val src = formula
        while (i < src.length) {
            val ch = src[i]
            if (ch == '"') {
                var j = i + 1
                while (j < src.length) {
                    if (src[j] == '"') { if (src.getOrNull(j + 1) == '"') { j += 2; continue }; break }
                    j += 1
                }
                out.append(src, i, minOf(j + 1, src.length))
                i = j + 1
                continue
            }
            if (ch == '{') {
                val end = src.indexOf('}', i)
                if (end > 0) { out.append(src, i, end + 1); i = end + 1; continue }
            }
            if ((ch.asciiLetter() || ch == '_' || ch == '$') && !(i > 0 && (src[i - 1].asciiLetter() || src[i - 1].asciiDigit() || src[i - 1] == '_'))) {
                var j = i
                while (j < src.length && identCh(src[j])) j += 1
                val word = src.substring(i, j)
                var k = j
                while (k < src.length && src[k] == ' ') k += 1
                val isCall = src.getOrNull(k) == '('
                val cell = if (isCall) null else CELL_RE.matchEntire(word)
                if (cell != null) {
                    val ref = A1Ref.Cell(letterToIndex(cell.groupValues[2]), cell.groupValues[4].toInt() - 1, cell.groupValues[1] == "$", cell.groupValues[3] == "$")
                    out.append(fn(ref, word) ?: word)
                    i = j
                    continue
                }
                val colA = if (isCall) null else COL_RE.matchEntire(word)
                if (colA != null && src.getOrNull(j) == ':') {
                    var e = j + 1
                    while (e < src.length && identCh(src[e])) e += 1
                    val bText = src.substring(j + 1, e)
                    val colB = COL_RE.matchEntire(bText)
                    if (colB != null) {
                        val a = A1Ref.Col(letterToIndex(colA.groupValues[2]), colA.groupValues[1] == "$")
                        val b = A1Ref.Col(letterToIndex(colB.groupValues[2]), colB.groupValues[1] == "$")
                        out.append(fn(a, word) ?: word).append(':').append(fn(b, bText) ?: bText)
                        i = e
                        continue
                    }
                }
                out.append(word)
                i = j
                continue
            }
            out.append(ch)
            i += 1
        }
        return out.toString()
    }

    private enum class Sep { SEMI, SEP, DEC_COMMA, DEC_DOT, OTHER }

    /** Walk a formula outside string literals and {stored refs}, classifying "," ";" and number literals. */
    private fun scanSeparators(src: String, visit: (Sep, Int) -> Unit) {
        var i = 0
        while (i < src.length) {
            val ch = src[i]
            if (ch == '"') {
                var j = i + 1
                while (j < src.length) { if (src[j] == '"') { if (src.getOrNull(j + 1) == '"') { j += 2; continue }; break }; j += 1 }
                for (k in i..minOf(j, src.length - 1)) visit(Sep.OTHER, k)
                i = j + 1
                continue
            }
            if (ch == '{') {
                val end = src.indexOf('}', i)
                if (end > 0) { for (k in i..end) visit(Sep.OTHER, k); i = end + 1; continue }
            }
            if (ch.asciiLetter() || ch == '_' || ch == '$') {
                var j = i
                while (j < src.length && identCh(src[j])) j += 1
                for (k in i until j) visit(Sep.OTHER, k)
                i = j
                continue
            }
            if (ch.asciiDigit()) {
                var j = i
                var decimal = false
                while (j < src.length) {
                    if (src[j].asciiDigit()) { visit(Sep.OTHER, j); j += 1; continue }
                    if (!decimal && (src[j] == ',' || src[j] == '.') && (src.getOrNull(j + 1)?.asciiDigit() == true)) {
                        visit(if (src[j] == ',') Sep.DEC_COMMA else Sep.DEC_DOT, j); decimal = true; j += 1; continue
                    }
                    break
                }
                i = j
                continue
            }
            visit(if (ch == ';') Sep.SEMI else if (ch == ',') Sep.SEP else Sep.OTHER, i)
            i += 1
        }
    }

    /** What people typed -> the neutral form ("," between arguments, "." decimals), or null when its commas are ambiguous. */
    fun canonicalFormula(a1: String): String? {
        var semis = 0; var seps = 0; var decCommas = 0
        scanSeparators(a1) { k, _ -> when (k) { Sep.SEMI -> semis++; Sep.SEP -> seps++; Sep.DEC_COMMA -> decCommas++; else -> Unit } }
        if (semis == 0 && seps > 0 && decCommas > 0) return null
        val out = StringBuilder()
        scanSeparators(a1) { k, i -> out.append(when (k) { Sep.SEMI -> ","; Sep.DEC_COMMA -> "."; else -> a1[i].toString() }) }
        return out.toString()
    }

    /** The neutral form -> how a person in the locale reads it (";" and decimal "," for Indonesian). */
    fun localizeFormula(neutral: String, en: Boolean = false): String {
        if (en) return neutral
        val out = StringBuilder()
        scanSeparators(neutral) { k, i -> out.append(when (k) { Sep.SEP, Sep.SEMI -> ";"; Sep.DEC_DOT -> ","; else -> neutral[i].toString() }) }
        return out.toString()
    }

    private fun bindRefs(display: String, shape: Shape): String = mapA1Refs(display) { ref, _ ->
        val col = shape.columnIds.getOrNull(ref.col) ?: return@mapA1Refs null
        when (ref) {
            is A1Ref.Col -> "{${if (ref.absCol) "$" else ""}$col!*}"
            is A1Ref.Cell -> {
                val row = shape.rowIds.getOrNull(ref.row) ?: return@mapA1Refs null
                "{${if (ref.absCol) "$" else ""}$col!${if (ref.absRow) "$" else ""}$row}"
            }
        }
    }

    /** "=SUM(B2:B9;A1)" -> stored, neutral, ids baked in; outside the sheet stays A1; ambiguous → "=?" + as typed. */
    fun toStored(display: String, shape: Shape): String {
        val neutral = canonicalFormula(display) ?: return AMBIGUOUS + bindRefs(display.removePrefix("="), shape)
        return bindRefs(neutral, shape)
    }

    private val STORED = Regex("\\{(\\$?)([^!}]+)!(\\$?)([^}]+)\\}")

    /** Stored form -> what the edit bar shows, using each id's CURRENT position. */
    fun toDisplay(stored: String, shape: Shape, en: Boolean = false): String {
        if (stored.startsWith(AMBIGUOUS)) return "=" + refsToA1(stored.substring(AMBIGUOUS.length), shape)
        return localizeFormula(refsToA1(stored, shape), en)
    }

    private fun refsToA1(stored: String, shape: Shape): String {
        val colIdx = shape.columnIds.withIndex().associate { it.value to it.index }
        val rowIdx = shape.rowIds.withIndex().associate { it.value to it.index }
        return STORED.replace(stored) { m ->
            val (ac, col, ar, row) = m.destructured
            val ci = colIdx[col] ?: return@replace REF_ERROR
            if (row == "*") return@replace "$ac${colLetter(ci)}"
            val ri = rowIdx[row] ?: return@replace REF_ERROR
            "$ac${colLetter(ci)}$ar${ri + 1}"
        }
    }

    // endregion
}
