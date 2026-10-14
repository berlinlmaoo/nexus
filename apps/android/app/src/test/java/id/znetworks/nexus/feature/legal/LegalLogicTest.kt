package id.znetworks.nexus.feature.legal

import id.znetworks.nexus.core.nav.Links
import id.znetworks.nexus.core.nav.Target
import id.znetworks.nexus.core.net.NexusJson
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.Instant

/** Legal (owner, 14 Oct 2026): the rules, the form helpers, the board and the request link, on the JVM. */
class LegalLogicTest {
    private fun doc(json: String) = NexusJson.decodeFromString(LgDocument.serializer(), json)

    // ── Status rules ──

    @Test fun statusChoicesFollowTheRules() {
        // VOID is one-way; SIGNED only goes to VOID; a generated document never picks SIGNED by hand.
        assertEquals(listOf("VOID"), LegalLogic.statusChoices("VOID", "GENERATED"))
        assertEquals(listOf("SIGNED", "VOID"), LegalLogic.statusChoices("SIGNED", "GENERATED"))
        assertEquals(listOf("DRAFT", "FINAL", "SENT", "VOID"), LegalLogic.statusChoices("DRAFT", "GENERATED"))
        assertEquals(listOf("DRAFT", "FINAL", "SENT", "SIGNED", "VOID"), LegalLogic.statusChoices("FINAL", "UPLOADED"))
    }

    @Test fun signedCopyAndAddendumOffers() {
        assertTrue(LegalLogic.canUploadSignedCopy("FINAL")); assertTrue(LegalLogic.canUploadSignedCopy("SENT"))
        assertFalse(LegalLogic.canUploadSignedCopy("DRAFT")); assertFalse(LegalLogic.canUploadSignedCopy("SIGNED"))
        assertTrue(LegalLogic.canCreateAddendum("SIGNED")); assertFalse(LegalLogic.canCreateAddendum("FINAL"))
    }

    @Test fun voidSaysWhatHappensToTheNumber() {
        assertEquals(LegalLogic.VoidOutcome.RELEASED, LegalLogic.voidOutcome(doc("""{"status":"FINAL","hasNumber":true}""")))
        assertEquals(LegalLogic.VoidOutcome.RETIRED, LegalLogic.voidOutcome(doc("""{"status":"SIGNED","hasNumber":true,"signedAt":"2026-10-14T03:00:00Z"}""")))
        assertEquals(LegalLogic.VoidOutcome.PLAIN, LegalLogic.voidOutcome(doc("""{"status":"DRAFT","source":"UPLOADED","hasNumber":false}""")))
    }

    @Test fun lockedAndFrozenHideEditing() {
        val signed = doc("""{"status":"SIGNED","versions":[{"version":1,"hasDocx":true},{"version":2,"hasDocx":true}]}""")
        assertTrue(LegalLogic.isLocked(signed)); assertFalse(LegalLogic.canReview(signed))
        val void = doc("""{"status":"VOID","versions":[{"version":1,"hasDocx":true}]}""")
        assertFalse(LegalLogic.isLocked(void)); assertTrue(LegalLogic.isFrozen(void)); assertFalse(LegalLogic.canReview(void))
        val draft = doc("""{"status":"DRAFT","versions":[{"version":1,"hasDocx":true},{"version":2,"hasDocx":false,"hasFile":true},{"version":3,"hasDocx":true}]}""")
        assertTrue(LegalLogic.canReview(draft)); assertTrue(LegalLogic.canCompare(draft))
        assertEquals(listOf(1, 3), LegalLogic.wordVersions(draft))
    }

    @Test fun shownVersionIsSignedThenFinalThenCurrent() {
        val vs = """"versions":[{"version":3},{"version":2},{"version":1}]"""
        assertEquals(3, LegalLogic.shownVersion(doc("""{"currentVersion":3,$vs}"""))?.version)
        assertEquals(2, LegalLogic.shownVersion(doc("""{"currentVersion":3,"finalVersion":2,$vs}"""))?.version)
        assertEquals(1, LegalLogic.shownVersion(doc("""{"currentVersion":3,"finalVersion":2,"signedVersion":1,$vs}"""))?.version)
    }

    @Test fun pdfIsAwaitedOnlyForThreeMinutes() {
        val now = Instant.parse("2026-10-14T10:00:00Z").toEpochMilli()
        val d = doc("""{"versions":[
            {"version":3,"hasDocx":true,"hasPdf":false,"createdAt":"2026-10-14T09:59:00Z"},
            {"version":2,"hasDocx":true,"hasPdf":false,"createdAt":"2026-10-14T09:50:00Z"},
            {"version":1,"hasDocx":true,"hasPdf":true,"createdAt":"2026-10-14T09:59:30Z"}]}""")
        assertEquals(listOf(3), LegalLogic.versionsAwaitingPdf(d, now).map { it.version })
    }

    @Test fun shareNamesCarryTheExtension() {
        val v = LgVersion(version = 2, fileName = "scan.JPG", downloadName = "SPK/001 - Talent REV 2")
        assertEquals("SPK/001 - Talent REV 2.pdf", LegalLogic.shareName(v, "pdf"))
        assertEquals("SPK/001 - Talent REV 2.jpg", LegalLogic.shareName(v, "original"))
        assertNull(LegalLogic.shareName(v.copy(downloadName = ""), "pdf"))
        assertEquals("SPK-001 - Talent REV 2.pdf", LegalLogic.safeFileName("SPK/001 - Talent REV 2.pdf", "x"))
        assertEquals("x", LegalLogic.safeFileName("  ", "x"))
    }

    // ── New document ──

    @Test fun numberPreviewReadsOnlyFormatFields() {
        assertEquals(listOf("KOTA", "KODE"), LegalLogic.formatFields("{SEQ:3}/{KOTA}/{CO}/{ROMAWI}/{BLN}/{MM}/{KODE:2}/{YYYY}/{YY}/{KOTA}"))
        assertEquals(emptyList<String>(), LegalLogic.formatFields("{SEQ:3}/INV/{CO}/{MM}/{YYYY}"))
        val values = mapOf("TANGGAL_DOKUMEN" to LgValue.Text("2026-10-14"), "KOTA" to LgValue.Text("JKT"), "NAMA" to LgValue.Text("A"))
        val inputs = LegalLogic.numberInputs(values, "{SEQ:3}/{KOTA}/{YYYY}")
        assertEquals(setOf("TANGGAL_DOKUMEN", "KOTA"), inputs.keys)
        assertEquals("KOTA=JKT|TANGGAL_DOKUMEN=2026-10-14", LegalLogic.numberKey(inputs))
    }

    @Test fun moneyGroupsWhileTyping() {
        assertEquals("25.000.000", LegalLogic.groupDigits("25000000"))
        assertEquals("25.000.000,5", LegalLogic.groupDigits("25.000.000,5"))
        assertEquals("1.000,25", LegalLogic.groupDigits("1000,257"))
        assertEquals("7", LegalLogic.groupDigits("007"))
        assertEquals("0", LegalLogic.groupDigits("0"))
        assertEquals("", LegalLogic.groupDigits("Rp "))
        assertEquals("25000000.5", LegalLogic.ungroup("25.000.000,5"))
        // A stored value comes back as the field shows it.
        assertEquals("25.000.000,5", LegalLogic.moneyShown("25000000.5"))
        assertEquals("12-3.5", LegalLogic.numberChars("12a-3.5"))
    }

    @Test fun startValuesPreferTheRequester() {
        val v = LegalLogic.startValues(
            mapOf("NAMA" to LgValue.Text("from request")),
            mapOf("NAMA" to LgValue.Text("from parent"), "ALAMAT" to LgValue.Text("Jl. X")),
            "2026-10-14",
        )
        assertEquals("from request", v["NAMA"]?.string)
        assertEquals("Jl. X", v["ALAMAT"]?.string)
        assertEquals("2026-10-14", v[LegalLogic.DOCUMENT_DATE]?.string)
        assertEquals("2026-10-14", LegalLogic.todayJakarta(Instant.parse("2026-10-13T17:30:00Z")))
    }

    @Test fun offeredTemplatesAndExtraErrors() {
        val t = listOf(LgTemplate(id = "a", docType = "SPK"), LgTemplate(id = "b", docType = "ADD"), LgTemplate(id = "c", docType = "NDA", archived = true))
        assertEquals(listOf("a"), LegalLogic.offeredTemplates(t, addendum = false).map { it.id })
        assertEquals(listOf("b"), LegalLogic.offeredTemplates(t, addendum = true).map { it.id })
        val fields = listOf(LgField(name = "ROWS"), LgField(name = "NAMA"))
        val extra = LegalLogic.extraErrors(mapOf("ROWS.0.CELL" to "x", "NAMA" to "y", "KOTA" to "Used in the document number"), fields)
        assertEquals(listOf("KOTA" to "Used in the document number"), extra)
    }

    @Test fun fieldEditorUpdatesNestedColumns() {
        val fields = listOf(LgField(name = "A"), LgField(name = "ROWS", type = "list", columns = listOf(LgField(name = "X"), LgField(name = "Y"))))
        val out = LegalLogic.updateField(fields, listOf(1, 1)) { it.copy(label = "Why") }
        assertEquals("Why", out[1].columns!![1].label)
        assertEquals(fields[0], out[0])
        assertEquals(fields, LegalLogic.updateField(fields, listOf(5)) { it.copy(label = "no") })
        assertEquals(listOf("a", "b", "c"), LegalLogic.choices("a, b,c"))
    }

    // ── Word diff ──

    @Test fun diffWordsMarksChangedWords() {
        val s = LegalLogic.diffWords("Jangka waktu 3 bulan sejak ditandatangani", "Jangka waktu 6 bulan sejak ditandatangani")
        assertEquals(listOf("same", "del", "ins", "same"), s.map { it.type })
        assertEquals("3", s[1].text); assertEquals("6", s[2].text)
        // Two neighbouring words change as one run (the space between them is absorbed).
        val t = LegalLogic.diffWords("a b c d", "a x y d")
        assertEquals(listOf(LgSegment("same", "a "), LgSegment("del", "b c"), LgSegment("ins", "x y"), LgSegment("same", " d")), t)
        assertEquals(listOf(LgSegment("same", "same")), LegalLogic.diffWords("same", "same"))
    }

    @Test fun compareFoldsUnchangedRuns() {
        val diff = listOf(LgDiff("same"), LgDiff("same"), LgDiff("changed"), LgDiff("same"), LgDiff("added"), LgDiff("removed"), LgDiff("same"))
        val rows = LegalLogic.diffRows(diff)
        assertEquals(listOf(LegalLogic.DiffRow.Folded(2), LegalLogic.DiffRow.Change(LgDiff("changed")), LegalLogic.DiffRow.Folded(1),
            LegalLogic.DiffRow.Change(LgDiff("added")), LegalLogic.DiffRow.Change(LgDiff("removed")), LegalLogic.DiffRow.Folded(1)), rows)
    }

    @Test fun proposalShownWhileItAppliesToTheCurrentVersion() {
        val p = listOf(LgProposal(id = "p2", status = "PENDING", baseVersion = 3), LgProposal(id = "p1", status = "APPLIED", baseVersion = 2))
        assertEquals("p2", LegalLogic.shownProposal(p, 3)?.id)
        assertNull(LegalLogic.shownProposal(p, 4))
        assertNull(LegalLogic.shownProposal(listOf(LgProposal(status = "DISCARDED", baseVersion = 3)), 3))
    }

    // ── Access ──

    @Test fun invitePowerDecidesInviteAndSettings() {
        assertTrue(LegalLogic.canInvite("ANY")); assertTrue(LegalLogic.canInvite("STAFF"))
        assertFalse(LegalLogic.canInvite("NONE")); assertFalse(LegalLogic.canInvite(null)); assertFalse(LegalLogic.canInvite("SOMETHING_NEW"))
        assertTrue(LegalLogic.canEditSettings("STAFF")); assertFalse(LegalLogic.canEditSettings("NONE"))
    }

    // ── Requests ──

    @Test fun requestLinkIdsAreRecognised() {
        assertTrue(LegalLogic.isRequestLinkId("legal-abcdefghijklmnopqrstuvwx"))
        assertTrue(LegalLogic.isRequestLinkId("legal-ABC123def456GHI789jkl012"))
        assertFalse(LegalLogic.isRequestLinkId("legal-short"))
        assertFalse(LegalLogic.isRequestLinkId("legal-abcdefghijklmnopqrstuvw!"))
        assertFalse(LegalLogic.isRequestLinkId("my-form-slug"))
        // The router: a Legal link opens the request form, any other /f/ id stays a form.
        assertEquals(Target.LegalRequestForm("legal-abcdefghijklmnopqrstuvwx"), Links.parse("https://nexus.znetworks.id/f/legal-abcdefghijklmnopqrstuvwx"))
        assertEquals(Target.Form("legal-short"), Links.parse("/f/legal-short"))
        assertEquals(Target.Form("finance"), Links.parse("/f/finance"))
    }

    @Test fun notificationLinksReachLegal() {
        assertEquals(Target.Submissions(null, "r1"), Links.parse("/submissions?legal=r1"))
        assertEquals(Target.Submissions("s1", null), Links.parse("/submissions?id=s1"))
        assertEquals(Target.Legal("requests", "r9", null), Links.parse("/legal?tab=requests&request=r9"))
        assertEquals(Target.Legal("documents", null, "d1"), Links.parse("/legal?tab=documents&doc=d1"))
        assertEquals(Target.Legal(), Links.parse("nexus://legal"))
    }

    @Test fun boardGroupsAndRules() {
        val rows = listOf(
            LgBoardRequest(id = "a", column = "TODO", deadline = "2026-10-01"),
            LgBoardRequest(id = "b", column = "IN_PROGRESS", deadline = "2026-10-20"),
            LgBoardRequest(id = "c", column = "DONE", deadline = "2026-10-01"),
            LgBoardRequest(id = "d", column = "SOMETHING_NEW"),
        )
        val cols = LegalLogic.columns(rows)
        assertEquals(listOf("TODO", "IN_PROGRESS", "DONE"), cols.keys.toList())
        assertEquals(listOf("a", "d"), cols["TODO"]!!.map { it.id })
        assertEquals(listOf("c"), cols["DONE"]!!.map { it.id })
        val today = "2026-10-14"
        assertTrue(LegalLogic.boardOverdue(rows[0], today)); assertFalse(LegalLogic.boardOverdue(rows[1], today))
        assertFalse(LegalLogic.boardOverdue(rows[2], today)) // done is never overdue
        assertEquals(listOf("IN_PROGRESS", "DONE"), LegalLogic.moveTargets("TODO"))

        val mine = LgMyRequest(deadline = "2026-10-01", stage = "IN_PROGRESS")
        assertTrue(LegalLogic.myOverdue(mine, today)); assertFalse(LegalLogic.myOverdue(mine.copy(stage = "SIGNED"), today))
    }

    @Test fun createAndRejectFromTheBoard() {
        val fresh = LgBoardRequest()
        assertTrue(LegalLogic.canCreateFromRequest(fresh)); assertTrue(LegalLogic.canReject(fresh))
        // An addendum request needs its signed parent first.
        val add = LgBoardRequest(isAddendum = true)
        assertTrue(LegalLogic.parentMissing(add)); assertFalse(LegalLogic.canCreateFromRequest(add))
        assertTrue(LegalLogic.canCreateFromRequest(add.copy(parent = LgBoardParent("p", "SPK/001"))))
        // A live document: Open instead of Create; a void one can be replaced.
        assertFalse(LegalLogic.canCreateFromRequest(fresh.copy(document = LgBoardDoc("d", status = "FINAL"))))
        assertTrue(LegalLogic.canCreateFromRequest(fresh.copy(document = LgBoardDoc("d", status = "VOID"))))
        assertFalse(LegalLogic.canReject(fresh.copy(document = LgBoardDoc("d", status = "SIGNED"))))
        assertFalse(LegalLogic.canReject(fresh.copy(rejected = true)))
        assertFalse(LegalLogic.rejectReasonOk(" ab ")); assertTrue(LegalLogic.rejectReasonOk("abc"))
    }

    @Test fun formTemplatesHideOtherCompanies() {
        val t = listOf(LgFormTemplate(id = "any"), LgFormTemplate(id = "pats", companyId = "c1"), LgFormTemplate(id = "intoo", companyId = "c2"))
        assertEquals(listOf("any", "pats"), LegalLogic.formTemplates(t, "c1").map { it.id })
        assertEquals(listOf("any", "pats", "intoo"), LegalLogic.formTemplates(t, null).map { it.id })
    }

    @Test fun requestInputCarriesParentNumberOnlyForAnAddendum() {
        val plain = LegalLogic.requestInput("t", "c", mapOf("A" to LgValue.Text("x")), " why ", null, "p1", null, addendum = false, parentNumber = "N")
        assertEquals("why", plain["purpose"]!!.jsonPrimitive.content)
        assertEquals("x", plain["values"]!!.jsonObject["A"]!!.jsonPrimitive.content)
        assertTrue(plain["deadline"].toString() == "null"); assertFalse("parentNumber" in plain)
        val add = LegalLogic.requestInput("t", "c", emptyMap(), "", "2026-10-30", null, "d1", addendum = true, parentNumber = " SPK/001 ")
        assertEquals("SPK/001", add["parentNumber"]!!.jsonPrimitive.content)
        assertEquals("2026-10-30", add["deadline"]!!.jsonPrimitive.content)
    }

    @Test fun answersReadAsText() {
        val cols = listOf(LgField(name = "PASAL", label = "Article"), LgField(name = "ISI", label = "New text"))
        val rows = LgValue.of(NexusJson.parseToJsonElement("""[{"PASAL":"3","ISI":"6 bulan"},{"PASAL":4}]"""))
        assertEquals("Article: 3\nNew text: 6 bulan\n\nArticle: 4\nNew text: —", LegalLogic.answerText(rows, "list", cols, "Yes") { it })
        assertEquals("Yes", LegalLogic.answerText(LgValue.Bool(true), "boolean", emptyList(), "Yes") { it })
        assertEquals("DAY 2026-10-14", LegalLogic.answerText(LgValue.Text("2026-10-14"), "date", emptyList(), "Yes") { "DAY $it" })
        assertEquals("—", LegalLogic.answerText(null, "text", emptyList(), "Yes") { it })
        val r = LgBoardRequest(fields = listOf(LgField(name = "A"), LgField(name = "B"), LgField(name = "C"), LgField(name = "D")),
            fieldValues = JsonObject(mapOf("A" to JsonPrimitive(""), "B" to JsonPrimitive(25000000), "D" to JsonPrimitive(false))))
        assertEquals(listOf("B", "D"), LegalLogic.answered(r).map { it.name })
    }

    @Test fun archiveQueryParams() {
        val q = LegalLogic.ArchiveQuery(q = " spk ", companyId = "c1", signed = "1", page = 2)
        assertEquals(listOf("q" to "spk", "companyId" to "c1", "signed" to "1", "page" to "2", "limit" to "50"), q.params())
        assertTrue(q.filtered); assertFalse(LegalLogic.ArchiveQuery(q = "x").filtered)
        assertEquals(Triple(51, 100, 120), LegalLogic.pageRange(2, 50, 120)); assertNull(LegalLogic.pageRange(1, 50, 50))
        assertEquals(listOf("picId" to "none", "deadline" to "overdue"), LegalLogic.BoardQuery(picId = "none", deadline = "overdue").params())
    }

    @Test fun formValuesRoundTrip() {
        val v = mapOf("A" to LgValue.Text("x"), "B" to LgValue.Bool(true), "ROWS" to LgValue.Rows(listOf(mapOf("C" to LgValue.Text("1")))))
        val json = LgValue.json(v)
        assertEquals("1", json["ROWS"]!!.jsonArray[0].jsonObject["C"]!!.jsonPrimitive.content)
        assertEquals(v, LgValue.values(json))
        // A number a requester typed reads as digits, without ".0".
        assertEquals(LgValue.Text("25000000"), LgValue.of(JsonPrimitive(25000000.0)))
    }
}
