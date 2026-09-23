export const EXTRACTION_VERSION = "1";

export const FIXTURE_BOOK_TITLE = "Navigation Notes: A Study Excerpt";
export const FIXTURE_AUTHOR = "Progress Island Fixtures";

/**
 * Small realistic source: numbered chapters with technical distinctions.
 * Used for tests and the labelled acceptance fixture.
 */
export const FIXTURE_SOURCE = `NAVIGATION NOTES: A STUDY EXCERPT
Edition: laboratory fixture, not a commercial book.

Chapter 1. Dead Reckoning Assumptions
Dead reckoning estimates present position from a known start, a heading, a speed, and elapsed time. It assumes the measured heading and speed remain representative over the interval. Currents, slip, and unmodeled bias make that assumption false. A dead-reckoning update is therefore a prediction, not an observation of location.

Chapter 2. Why a Compass Heading Is Not a Course Over Ground
A magnetic compass reports heading relative to magnetic north, after local variation and deviation are applied. Course over ground is the path actually travelled relative to the Earth. Wind or current can make course over ground diverge from heading even when the compass is correctly corrected. Treating heading as course over ground silently drops that distinction.

Chapter 3. Bayes Updates Need a Likelihood
A Bayesian navigation filter multiplies a prior over states by a likelihood of the latest measurement. Without a likelihood model, there is no principled update, only an ad hoc blend. Gaussian filters encode the likelihood through a measurement matrix and a noise covariance; if either is invented without evidence, the posterior covariance is not meaningful.

Chapter 4. Observability Versus Noise
A state is observable when the measurements contain enough information to recover it in the noise-free case. Adding sensors can improve observability, but high noise can still leave the estimate practically useless. Observability is a structural property; it does not by itself guarantee a small error.

Chapter 5. When to Trust a Map Constraint
A map matching step is an observation only if the map corresponds to the same place and the same edition of the world. Using a mismatched map is equivalent to applying a wrong measurement. Prefer withholding the constraint over forcing a visually neat alignment.
`;

export const FIXTURE_CHAPTER_TITLES = [
  "Dead Reckoning Assumptions",
  "Why a Compass Heading Is Not a Course Over Ground",
  "Bayes Updates Need a Likelihood",
  "Observability Versus Noise",
  "When to Trust a Map Constraint",
];
