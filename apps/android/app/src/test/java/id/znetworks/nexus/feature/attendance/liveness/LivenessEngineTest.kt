package id.znetworks.nexus.feature.attendance.liveness

import id.znetworks.nexus.feature.attendance.liveness.LivenessEngine.Frame
import id.znetworks.nexus.feature.attendance.liveness.LivenessEngine.Step
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class LivenessEngineTest {
    private var clock = 0L
    private val engine = LivenessEngine { clock }

    private fun face(yaw: Float = 0f, eyes: Float = 0.95f, size: Float = 0.5f, dx: Float = 0f) =
        Frame(true, yaw, eyes, eyes, size, dx, 0f)

    /** Feed [n] frames ~33 ms apart (30 fps). */
    private fun feed(f: Frame, n: Int = 1) = repeat(n) { clock += 33; engine.onFrame(f) }
    private fun waitCooldown() { clock += 600 }

    private fun passToBlink(firstTurn: Float = 25f) {
        feed(face(), 6); assertEquals(Step.SIDE_A, engine.state.step)
        waitCooldown(); feed(face(yaw = firstTurn), 3); assertEquals(Step.SIDE_B, engine.state.step)
        waitCooldown(); feed(face(yaw = -firstTurn), 3); assertEquals(Step.BLINK, engine.state.step)
        waitCooldown()
    }

    @Test fun fullSequenceEitherDirection() {
        for (dir in listOf(25f, -25f)) {
            val e = LivenessEngine { clock }
            fun f(fr: Frame, n: Int) = repeat(n) { clock += 33; e.onFrame(fr) }
            f(face(), 6); clock += 600
            f(face(yaw = dir), 3); clock += 600
            f(face(yaw = -dir), 3); clock += 600
            f(face(eyes = 0.95f), 5); f(face(eyes = 0.1f), 2); f(face(eyes = 0.95f), 1)
            assertEquals(Step.CAPTURE, e.state.step); clock += 600
            f(face(), 4)
            assertTrue("dir=$dir", e.state.readyToCapture)
        }
    }

    @Test fun secondTurnMustBeTheOppositeWay() {
        feed(face(), 6); waitCooldown()
        feed(face(yaw = 25f), 3); waitCooldown()
        feed(face(yaw = 25f), 10) // same side again
        assertEquals(Step.SIDE_B, engine.state.step)
        assertEquals(0f, engine.state.turnProgress)
    }

    @Test fun smallTurnDoesNotCount() {
        feed(face(), 6); waitCooldown()
        feed(face(yaw = 20f), 20) // below 21.8°
        assertEquals(Step.SIDE_A, engine.state.step)
    }

    @Test fun printedPhotoCannotBlink() {
        passToBlink()
        feed(face(eyes = 0.9f), 200) // eyes never close
        assertEquals(Step.BLINK, engine.state.step)
        assertFalse(engine.state.readyToCapture)
    }

    @Test fun blinkNeedsReopening() {
        passToBlink()
        feed(face(eyes = 0.95f), 5)
        feed(face(eyes = 0.1f), 10) // eyes stay shut
        assertEquals(Step.BLINK, engine.state.step)
        feed(face(eyes = 0.95f), 1)
        assertEquals(Step.CAPTURE, engine.state.step)
    }

    @Test fun faceLostAfterFirstStepRestarts() {
        feed(face(), 6); waitCooldown()
        feed(face(yaw = 25f), 3)
        feed(LivenessEngine.Frame(false), 46)
        assertEquals(Step.CENTER, engine.state.step)
        assertEquals(LivenessEngine.Notice.FACE_LOST, engine.state.notice)
    }

    @Test fun tooSmallOrOffCentreBlocksProgress() {
        feed(face(size = 0.2f), 20)
        assertEquals(LivenessEngine.Presence.SMALL, engine.state.presence)
        assertEquals(Step.CENTER, engine.state.step)
        feed(face(dx = 0.3f), 20)
        assertEquals(LivenessEngine.Presence.OFF_CENTRE, engine.state.presence)
        assertEquals(Step.CENTER, engine.state.step)
    }

    @Test fun captureWaitsForOpenEyesAndFrontalFace() {
        passToBlink()
        feed(face(eyes = 0.95f), 5); feed(face(eyes = 0.1f), 2); feed(face(eyes = 0.95f), 1)
        waitCooldown()
        feed(face(yaw = 15f), 10)
        assertFalse(engine.state.readyToCapture)
        feed(face(), 4)
        assertTrue(engine.state.readyToCapture)
    }

    @Test fun cooldownBetweenSteps() {
        feed(face(), 6)
        feed(face(yaw = 25f), 5) // inside the 500 ms cooldown: ignored
        assertEquals(Step.SIDE_A, engine.state.step)
    }
}
