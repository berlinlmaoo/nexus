package id.znetworks.nexus.feature.legal

import id.znetworks.nexus.core.net.ApiError
import id.znetworks.nexus.core.net.NexusJson
import kotlinx.serialization.json.jsonObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** Decoding of the Legal answers (docs/legal-api.md samples): tolerant of missing, null and unknown fields. */
class LegalModelsTest {
    private inline fun <reified T> decode(ser: kotlinx.serialization.KSerializer<T>, json: String): T = NexusJson.decodeFromString(ser, json)

    @Test fun documentDecodes() {
        val d = decode(LgDocumentOne.serializer(), """{"document":{
            "id":"d1","number":"SPK/001/PATS/X/2026","docType":"SPK","title":"Talent","counterparty":"PT A","docDate":"2026-10-14",
            "status":"SIGNED","source":"GENERATED","company":{"id":"c1","code":"PATS","name":"PATS"},"project":null,"deal":null,
            "linkHidden":true,"currentVersion":3,"finalVersion":2,"signedVersion":3,"hasNumber":true,"signedAt":"2026-10-14T03:00:00Z",
            "signedBy":{"id":"u1","name":"Berlin","avatar":null},"numberReleased":false,"numberReusedBy":null,
            "numberReusedFrom":[{"id":"d0","number":"SPK/000","title":"Old"}],"parent":null,"addendumNo":null,
            "addenda":[{"id":"a1","number":"SPK/001/ADD-1","title":"Add","status":"DRAFT","docDate":"2026-10-15","signedAt":null,"addendumSeq":1,"numberReleased":false}],
            "template":{"id":"t1","name":"SPK","version":2},"series":{"id":"s1","key":"pats-spk","label":"SPK","format":"{SEQ:3}"},
            "versions":[{"version":3,"kind":"UPLOAD","fileName":"signed.pdf","mimeType":"application/pdf","size":2048,"hasDocx":false,"hasPdf":true,
              "hasFile":true,"note":"","changes":null,"author":{"id":"u1","name":"Berlin"},"createdAt":"2026-10-14T03:00:00Z","label":"SIGNED",
              "downloadName":"SPK/001 - Talent SIGNED"},{"version":2,"kind":"SOMETHING_NEW","label":"FINAL"}],
            "brandNewField":{"x":1}}}""").document!!
        assertEquals("SIGNED", d.status); assertTrue(d.linkHidden); assertEquals(3, d.signedVersion)
        assertEquals("Berlin", d.signedBy?.name); assertEquals(1, d.addenda.size); assertEquals("SPK/000", d.numberReusedFrom[0].number)
        assertEquals("SIGNED", d.versions[0].shownLabel); assertEquals("SOMETHING_NEW", d.versions[1].kind)
        assertEquals("REV 7", LgVersion(version = 7).shownLabel)
    }

    @Test fun archivePageAndPrepare() {
        val p = decode(LgDocsPage.serializer(), """{"documents":[{"id":"x","number":"","status":"VOID","numberReleased":true,
            "numberReusedBy":{"id":"y","number":"N/1","title":"T"},"parent":{"id":"p","number":"P/1","title":"Parent","status":"SIGNED","docType":"PKS"},"addendaCount":2}],
            "total":120,"page":2,"pageSize":50}""")
        assertEquals(120, p.total); assertTrue(p.documents[0].numberReleased); assertEquals("N/1", p.documents[0].numberReusedBy?.number)
        val prep = decode(LgPrepared.serializer(), """{"template":{"id":"t","name":"Add","docType":"ADD","version":1},"company":{"id":"c","code":"PATS","name":"PATS","hasKop":false},
            "series":null,"fields":[{"name":"TANGGAL_DOKUMEN","label":"","type":"date","required":true},{"name":"ROWS","label":"Rows","type":"list",
              "columns":[{"name":"PASAL","label":"Article","type":"text"}]}],"numberPreview":"P/1/ADD-1","parent":{"id":"p","number":"P/1","title":"T","addendumNo":1},
            "prefill":{"NAMA":"PT A","NILAI":25000000}}""")
        assertEquals("TANGGAL_DOKUMEN", prep.fields[0].shownLabel) // an empty label shows the name
        assertEquals("PASAL", prep.fields[1].columns!![0].name)
        assertEquals(1, prep.parent?.addendumNo); assertFalse(prep.company!!.hasKop)
        assertEquals(mapOf("NAMA" to LgValue.Text("PT A"), "NILAI" to LgValue.Text("25000000")), LgValue.values(prep.prefill))
    }

    @Test fun myRequestAndBoardRequestDecode() {
        val mine = decode(LgMyRequests.serializer(), """{"requests":[{"id":"r1","createdAt":"2026-10-14T01:00:00Z","company":{"id":"c1","name":"PATS"},
            "templateName":"SPK Talent","docType":"SPK","isAddendum":false,"parentNumberText":"","deadline":"2026-10-20","stage":"FINAL",
            "rejectReason":null,"pic":{"id":"u2","name":"Legal","avatar":null},"document":{"number":"SPK/001","title":"Talent","status":"FINAL"},
            "canDownload":true,"purpose":"for X","attachments":[{"id":"a1","fileName":"ktp.jpg","mimeType":"image/jpeg","size":1000}],
            "project":{"id":"p1","name":"Proj"},"deal":null}]}""").requests[0]
        assertEquals("FINAL", mine.stage); assertTrue(mine.canDownload); assertEquals("SPK/001", mine.document?.number); assertEquals("ktp.jpg", mine.attachments[0].fileName)
        val detail = decode(LgMyRequestOne.serializer(), """{"request":{"id":"r1","stage":"REJECTED","rejectReason":"Wrong company",
            "answers":[{"name":"ROWS","label":"Rows","type":"list","value":[{"A":"1"}],"columns":[{"name":"A","label":"A"}]},{"name":"X","label":"X","type":"text","value":null}]}}""").request!!
        assertEquals("Wrong company", detail.rejectReason); assertEquals(2, detail.answers.size)
        assertEquals(LgValue.Rows(listOf(mapOf("A" to LgValue.Text("1")))), LgValue.of(detail.answers[0].value)); assertNull(LgValue.of(detail.answers[1].value))

        val b = decode(LgBoardDetail.serializer(), """{"request":{"id":"r2","requester":{"id":"u","name":"Ana"},"company":{"id":"c1","code":"PATS","name":"PATS"},
            "templateId":"t1","templateName":"Addendum","docType":"ADD","isAddendum":true,"parentNumberText":"SPK/001","parent":null,"deadline":null,
            "column":"TODO","stage":"RECEIVED","rejected":false,"rejectReason":"","pic":null,"document":null,"purpose":"","attachments":[],"linkHidden":false,
            "fieldValues":{"PERUBAHAN":[{"PASAL_DIUBAH":"3","ISI_BARU":"x"}]},"fields":[{"name":"PERUBAHAN","label":"Changes","type":"list"}]},
            "prefill":{"requestId":"r2","templateId":"t1","companyId":"c1","isAddendum":true,"parentDocumentId":null,"values":{"PERUBAHAN":[]},"projectId":null,"dealId":null}}""")
        assertEquals("Ana", b.request?.requester?.name); assertTrue(b.request!!.isAddendum); assertTrue(LegalLogic.parentMissing(b.request!!))
        assertEquals("c1", b.prefill?.companyId); assertNull(b.prefill?.parentDocumentId)
        assertEquals(listOf("PERUBAHAN"), LegalLogic.answered(b.request!!).map { it.name })
    }

    @Test fun formInfoAndLinks() {
        val f = decode(LgFormInfo.serializer(), """{"link":{"company":{"id":"c1","name":"PATS"},"accepting":true},"signedIn":true,
            "companies":[{"id":"c1","code":"PATS","name":"PATS"}],"templates":[{"id":"t","name":"NDA","description":"","docType":"NDA","companyId":null,"isAddendum":false,"fields":[]}]}""")
        assertEquals("c1", f.lockedCompany?.id); assertTrue(f.accepting); assertEquals("NDA", f.templates[0].docType)
        // Not accepting / no link object: closed, never a crash.
        assertFalse(decode(LgFormInfo.serializer(), """{"link":{"company":null,"accepting":false},"signedIn":true}""").accepting)
        assertFalse(decode(LgFormInfo.serializer(), "{}").accepting)
        val links = decode(LgRequestLinks.serializer(), """{"links":[{"scope":"general","company":null,"path":"/f/legal-abcdefghijklmnopqrstuvwx","accepting":true,
            "rotatedAt":null,"updatedAt":"2026-10-14T01:00:00Z"}]}""")
        assertEquals("general", links.links[0].scope); assertTrue(LegalLogic.isRequestLinkId(links.links[0].path.removePrefix("/f/")))
    }

    @Test fun membersAndProposals() {
        val m = decode(LgMembers.serializer(), """{"members":[{"userId":"u1","name":"","email":"a@example.com","isRoot":true,"active":true,"invitePower":"ANY",
            "invitedBy":null,"canRevoke":false},{"userId":"u2","name":"B","active":false,"revokedAt":"2026-10-01T00:00:00Z","revokedBy":{"id":"u1","name":"Root"}}],"invitePower":"STAFF"}""")
        assertEquals("a@example.com", m.members[0].shownName); assertEquals("STAFF", m.invitePower); assertEquals("Root", m.members[1].revokedBy?.name)
        val p = decode(LgProposals.serializer(), """{"proposals":[{"id":"p","status":"CLARIFY","baseVersion":2,"instruction":"","question":"Which article?",
            "summary":"","changes":[{"index":4,"before":"a","after":"b","segments":[{"type":"del","text":"a"},{"type":"ins","text":"b"}]}],"appliedVersion":null}]}""")
        assertEquals("Which article?", p.proposals[0].question); assertEquals("ins", p.proposals[0].changes[0].segments[1].type)
        val cmp = decode(LgCompare.serializer(), """{"a":1,"b":2,"diff":[{"type":"same","a":0,"b":0,"text":"x"},{"type":"removed","a":1,"text":"y"},
            {"type":"changed","a":2,"b":1,"before":"p","after":"q","segments":[]}]}""")
        assertEquals(listOf("same", "removed", "changed"), cmp.diff.map { it.type }); assertNull(cmp.diff[1].b)
    }

    @Test fun refusalsCarryFieldErrorsAndProblems() {
        val body = NexusJson.parseToJsonElement("""{"error":"Check the form","fieldErrors":{"NAMA":"Required","ROWS.0.PASAL":"Required"},"problems":["Unclosed {{#ROWS}}"]}""").jsonObject
        val e = ApiError.Http(422, "Check the form", null, body)
        assertEquals(mapOf("NAMA" to "Required", "ROWS.0.PASAL" to "Required"), e.legalFieldErrors())
        assertEquals(listOf("Unclosed {{#ROWS}}"), e.legalProblems())
        assertFalse(e.legalNotInvited()); assertFalse(e.legalConflict())
        assertTrue(ApiError.Http(403, "No", "LEGAL_NOT_INVITED", null).legalNotInvited())
        assertFalse(ApiError.Http(403, "No", "SOMETHING_ELSE", null).legalNotInvited())
        assertTrue(ApiError.Http(409, null, null, null).legalConflict())
        assertEquals(emptyMap<String, String>(), ApiError.Transport(RuntimeException()).legalFieldErrors())
    }

    @Test fun fileNamesFromTheServer() {
        assertEquals("SPK 001 FINAL.pdf", LegalApi.dispositionName("attachment; filename=\"SPK_001_FINAL.pdf\"; filename*=UTF-8''SPK%20001%20FINAL.pdf"))
        assertEquals("kop.docx", LegalApi.dispositionName("attachment; filename=\"kop.docx\""))
        assertNull(LegalApi.dispositionName(null))
        assertEquals("application/pdf", LegalApi.mimeFor("x.PDF")); assertEquals("application/octet-stream", LegalApi.mimeFor("x.pptx"))
    }
}
