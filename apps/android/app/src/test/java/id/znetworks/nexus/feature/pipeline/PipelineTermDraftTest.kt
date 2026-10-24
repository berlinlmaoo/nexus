package id.znetworks.nexus.feature.pipeline

import id.znetworks.nexus.core.session.Session
import org.junit.Assert.*
import org.junit.Test

class PipelineTermDraftTest {
    private fun newTerm(key: String = "dialog") = PipelineTermDraft(key, "deal", null, PipelineTermFields(amount = "1.000"))
    private fun payment() = PipelineTermDraft("payment", "deal", "term", PipelineTermFields(amount = "1.000", date = "2026-10-24"))

    @Test fun dirtyBackAndCancelKeepAllValuesUntilDiscardIsConfirmed() {
        val edited = newTerm().edit(PipelineTermFields("October payment", "2.000", "2026-11-01"))
        val prompted = edited.requestClose()!!
        assertTrue(prompted.discard)
        assertEquals(edited.fields, prompted.fields)
        val kept = prompted.keepEditing()
        assertFalse(kept.discard)
        assertEquals(edited.fields, kept.fields)
        assertTrue(kept.dirty)
        assertNull(kept.requestClose()!!.discardChanges())
    }

    @Test fun unchangedAndRevertedDialogsCloseWithoutAConfirmation() {
        val draft = newTerm()
        assertNull(draft.requestClose())
        assertNull(draft.edit(draft.fields.copy(label = "temporary")).edit(draft.initial).requestClose())
        assertNull(payment().requestClose())
    }

    @Test fun markPaidProtectsBothTheTypedAmountAndTheChangedDate() {
        val amount = payment().edit(payment().fields.copy(amount = "500"))
        assertTrue(amount.requestClose()!!.discard)
        val dated = payment().edit(payment().fields.copy(date = "2026-10-25"))
        assertTrue(dated.requestClose()!!.discard)
        assertEquals("2026-10-25", dated.requestClose()!!.keepEditing().fields.date)
    }

    @Test fun aRetainedSubmissionBlocksDuplicateSaveEditingAndDismissal() {
        val edited = newTerm().edit(PipelineTermFields("Deposit", "500", "2026-10-25"))
        val sent = edited.submit()!!
        assertTrue(sent.busy)
        assertEquals(1, sent.attempt)
        assertNull(sent.submit())
        assertEquals(sent, sent.edit(sent.fields.copy(label = "changed while saving")))
        assertEquals(sent, sent.requestClose())
        assertEquals(sent, sent.discardChanges())
        // Rotation changes the observer, not this ViewModel-owned submission or its completion.
        assertNull(sent.completed(sent, success = true))
    }

    @Test fun failedSaveRetainsTheDraftAndRetryRejectsThePreviousAttempt() {
        val edited = newTerm().edit(PipelineTermFields("Deposit", "500", "2026-10-25"))
        val first = edited.submit()!!
        val failed = first.completed(first, success = false)!!
        assertFalse(failed.busy)
        assertEquals(edited.fields, failed.fields)
        assertEquals(edited.initial, failed.initial)
        val retry = failed.submit()!!
        assertEquals(first.key, retry.key)
        assertEquals(2, retry.attempt)
        assertEquals(retry, retry.completed(first, success = true))
        assertNull(retry.completed(retry, success = true))
    }

    @Test fun oldAcknowledgementsCannotCloseOrUnlockAnotherDialog() {
        val old = newTerm("old").submit()!!
        val current = newTerm("new").edit(PipelineTermFields("New deposit", "250")).submit()!!
        assertEquals(current, current.completed(old, success = true))
        assertEquals(current, current.completed(old, success = false))
        assertEquals(payment(), payment().completed(old, success = true))
    }

    @Test fun invalidAmountsAndMissingPaymentDatesNeverStartRequests() {
        for (value in listOf("invalid", "-1", "9".repeat(400))) {
            assertNull(newTerm().edit(PipelineTermFields(amount = value)).submit())
        }
        assertNull(payment().edit(payment().fields.copy(date = null)).submit())
        assertNotNull(newTerm().edit(PipelineTermFields(amount = "")).submit())
    }

    @Test fun profileMetadataRefreshDoesNotDisableTheRetainedDraftOwner() {
        val session = Session("credential", "session", "owner", "Before", "before@example.test", 100L)
        val owner = PipelineTermOwner("https://dev.example.test/", session)
        assertTrue(owner.accepts("https://dev.example.test/", session.copy(
            userName = "After", userEmail = "after@example.test", expiresAtMillis = 200L)))
    }

    @Test fun anotherCredentialAccountOrServerCannotUseTheRetainedDraftOwner() {
        val base = "https://dev.example.test/"
        val session = Session("credential", "session", "owner")
        val owner = PipelineTermOwner(base, session)
        assertFalse(owner.accepts(base, session.copy(token = "replacement")))
        assertFalse(owner.accepts(base, session.copy(cookieName = "another-cookie")))
        assertFalse(owner.accepts(base, session.copy(userId = "another-owner")))
        assertFalse(owner.accepts("https://other.example.test/", session))
        assertFalse(owner.accepts(base, null))
        assertFalse(PipelineTermOwner(base, null).accepts(base, session))
    }
}
