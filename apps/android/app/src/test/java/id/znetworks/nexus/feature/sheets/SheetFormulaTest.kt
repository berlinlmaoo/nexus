package id.znetworks.nexus.feature.sheets

import id.znetworks.nexus.feature.sheets.SheetFormula.Detected
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** The web's own lib/sheet-formula.test.mjs cases for the parts ported to the phone (no evaluator). */
class SheetFormulaTest {
    private fun num(s: String) = SheetFormula.parseLocaleNumber(s)?.n
    private fun det(s: String) = SheetFormula.detectInput(s)
    private val oct11 = SheetFormula.ymdToSerial(2026, 10, 11).toDouble()

    @Test fun numbersAsTypedInIndonesia() {
        assertEquals(1500000.0, num("1.500.000")); assertEquals(1500.0, num("1.500")); assertEquals(1.5, num("1.5"))
        assertEquals(0.5, num("0.500")); assertEquals(1.5, num("1,5")); assertEquals(1500000.5, num("1.500.000,50"))
        assertEquals(1500000.5, num("1,500,000.50")); assertEquals(-250.0, num("(250)")); assertEquals(-1234.0, num("-1.234"))
        assertNull(num("abc")); assertNull(num("1.2.3")); assertNull(num("1,"))
        // en-US swaps the marks.
        assertEquals(1500.25, SheetFormula.parseLocaleNumber("1,500.25", en = true)?.n); assertEquals(1500.0, SheetFormula.parseLocaleNumber("1,500", en = true)?.n)
    }

    @Test fun detectInput() {
        assertEquals(Detected.Number(1500000.0, "idr"), det("Rp 1.500.000"))
        assertEquals(Detected.Number(1500000.0, "idr"), det("Rp1.500.000,-"))
        assertEquals(Detected.Number(-5000.0, "idr"), det("-Rp 5.000"))
        assertEquals(Detected.Number(2500.0, "idr"), det("IDR 2.500"))
        assertEquals(Detected.Number(0.15, "pct"), det("15%"))
        assertEquals(Detected.Number(0.015, "pct"), det("1,5%"))
        assertEquals(Detected.Number(1500000.0, "num"), det("1.500.000"))
        assertEquals(Detected.Number(1500.0, null), det("1500"))
        assertEquals(Detected.Number(1.5, "num"), det("1,5"))
        assertEquals(Detected.Number(oct11, "date"), det("11/10/2026"))
        assertEquals(oct11, (det("11 Okt 2026") as Detected.Number).v, 0.0)
        assertEquals("date", (det("2026-10-11") as Detected.Number).nf)
        assertTrue(det("31/02/2026") is Detected.Text)
        assertTrue(det("08123456789") is Detected.Text); assertTrue(det("+6281234567890") is Detected.Text)
        assertTrue(det("3201234567890001") is Detected.Text); assertTrue(det("abc") is Detected.Text); assertTrue(det("Q4 2026") is Detected.Text)
        assertEquals(Detected.Empty, det("  "))
        assertEquals(Detected.Number(1500000.5, "idr"), det("Rp1.500.000,50"))
        assertEquals(Detected.Number(1.5, "num"), det("1.5"))
    }

    @Test fun datesAndFormats() {
        assertEquals(46306, SheetFormula.ymdToSerial(2026, 10, 11))
        assertEquals("2026-10-11", SheetFormula.serialToIso(46306.0))
        assertEquals("11 Okt 2026", SheetFormula.formatDateSerial(46306.0))
        assertEquals("Oct 11, 2026", SheetFormula.formatDateSerial(46306.0, en = true))
        assertEquals(oct11, SheetFormula.parseDateText("10/11/2026", en = true)!!.toDouble(), 0.0) // month first in en-US
        assertEquals("Rp 1.500.000", SheetFormula.formatNumber(1500000.0, "idr"))
        assertEquals("15%", SheetFormula.formatNumber(0.15, "pct"))
        assertEquals("1.500.000", SheetFormula.formatNumber(1500000.0, "num"))
        assertEquals("1,5", SheetFormula.formatNumber(1.5, null))
        assertEquals("Rp 1.500.000", SheetFormula.editTyped(1500000.0, "idr"))
        assertEquals(Detected.Number(0.125, "pct"), det(SheetFormula.editTyped(0.125, "pct")))
        assertEquals(Detected.Number(46306.0, "date"), det(SheetFormula.editTyped(46306.0, "date")))
        assertEquals("1,500.25", SheetFormula.formatGrouped(1500.25, 2, en = true))
        assertEquals("-2.500", SheetFormula.formatGrouped(-2500.0))
    }

    private val shape = SheetFormula.Shape(listOf("ca", "cb", "cc", "cd"), listOf("r1", "r2", "r3", "r4", "r5"))

    @Test fun a1AndStored() {
        assertEquals("=IF({ca!r2}=\"Q4\",{cb!r2},0)", SheetFormula.toStored("=IF(A2=\"Q4\";B2;0)", shape))
        assertEquals("=IF(A2=\"Q4\";B2*1,5;0)", SheetFormula.toDisplay("=IF({ca!r2}=\"Q4\",{cb!r2}*1.5,0)", shape))
        assertEquals("=IF(A1>1,\"y\",\"n\")", SheetFormula.canonicalFormula("=IF(A1>1,\"y\",\"n\")"))
        assertEquals("=SUM(A1,B1)", SheetFormula.canonicalFormula("=SUM(A1,B1)"))
        assertEquals("=A1*1.5", SheetFormula.canonicalFormula("=A1*1,5"))
        assertEquals("=IF(A1,\"a,b\",1.5)", SheetFormula.canonicalFormula("=IF(A1;\"a,b\";1,5)"))
        assertNull(SheetFormula.canonicalFormula("=IF(A1>1,1,5)"))
        assertEquals("=?IF({ca!r1}>1,1,5)", SheetFormula.toStored("=IF(A1>1,1,5)", shape))
        assertEquals("=IF(A1>1,1,5)", SheetFormula.toDisplay("=?IF({ca!r1}>1,1,5)", shape))
        assertEquals("=STDEV.S(A1:A3)+0,5", SheetFormula.localizeFormula("=STDEV.S(A1:A3)+0.5"))
        assertEquals("=SUM({\$ca!\$r1}:{ca!\$r3})", SheetFormula.toStored("=SUM(\$A\$1:A\$3)", shape))
        assertEquals("=SUM({cb!*}:{cb!*})", SheetFormula.toStored("=SUM(B:B)", shape))
        assertEquals("=LOG10({ca!r1})", SheetFormula.toStored("=LOG10(A1)", shape))
        assertEquals("=A99", SheetFormula.toStored("=A99", shape))
        assertEquals("=SUM(\$A\$1:A\$3)", SheetFormula.toDisplay("=SUM({\$ca!\$r1}:{ca!\$r3})", shape))
        assertEquals("=SUM(B:C)", SheetFormula.toDisplay("=SUM({cb!*}:{cc!*})", shape))
        assertEquals("=#REF!+#REF!", SheetFormula.toDisplay("={gone!r1}+{ca!gone}", shape))
        // en-US shows the neutral separators.
        assertEquals("=SUM(A1,B1*1.5)", SheetFormula.toDisplay("=SUM({ca!r1},{cb!r1}*1.5)", shape, en = true))
        assertEquals("AA", SheetFormula.colLetter(26)); assertEquals(26, SheetFormula.letterToIndex("AA")); assertEquals("A", SheetFormula.colLetter(0))
    }
}
