export const depthVertexShader = /* glsl */ `
	varying vec2 vUv;

	void main() {
		vUv = uv;
		gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
	}
`;

export const depthFragmentShader = /* glsl */ `
	uniform sampler2D uImage;
	uniform sampler2D uDepth;
	uniform sampler2D uMask;
	uniform vec2 uMaskTexelSize;
	uniform sampler2D uLighting;
	uniform float uLightingStrength;
	uniform vec2 uMouse;
	uniform float uDepthStrength;
	uniform float uParallaxStrength;
	uniform float uInvert;

	// Depth of field. uFocusActive stays 0 until the user's first click, so a
	// project that hasn't touched this feature renders identically to before
	// DOF existed. uMaxBlurLod is a mip-level count (~4-6), not a pixel
	// radius — the blur comes from textureLod reading genuinely pre-filtered
	// mip data, not from faking it with sharp point samples.
	uniform float uFocusActive;
	uniform float uFocusDepth;
	uniform float uFocusRange;
	uniform float uFocusFalloff;
	uniform float uMaxBlurLod;

	// Atmospheric haze. Unlike DOF, this has a sensible always-on default
	// (uHazeStrength starts mild, not 0) since it's a continuous rendering
	// property, not a stage the user has to discover/activate.
	uniform vec3 uHazeColor;
	uniform float uHazeStrength;

	varying vec2 vUv;

	// GLSL3 (needed for textureLod) has no gl_FragColor — attribute/varying/
	// texture2D are still auto-translated by three.js's GLSL3 prefix macros,
	// but the fragment output needs an explicit "out" variable instead.
	out vec4 fragColor;

	void main() {
		float depth = texture2D(uDepth, vUv).r;
		depth = mix(depth, 1.0 - depth, uInvert);

		// A flat/neutral (full-white) mask has zero local gradient everywhere,
		// so edgeMagnitude is always 0 and edgeSoftening is always 1 — a
		// project that hasn't run segmentation renders identically to before
		// this uniform existed. Once a real mask is present, edgeMagnitude
		// spikes at the foreground silhouette boundary, which is exactly
		// where depth-only parallax stretches/tears the background — scaling
		// depth strength down there is what fixes it.
		float maskCenter = texture2D(uMask, vUv).r;
		float maskRight = texture2D(uMask, vUv + vec2(uMaskTexelSize.x, 0.0)).r;
		float maskUp = texture2D(uMask, vUv + vec2(0.0, uMaskTexelSize.y)).r;
		float edgeMagnitude = abs(maskRight - maskCenter) + abs(maskUp - maskCenter);
		float edgeSoftening = 1.0 - clamp(edgeMagnitude * 4.0, 0.0, 1.0);

		// How far this pixel's own depth is from the clicked focus depth
		// decides its blur amount — computed here, before the parallax
		// offset/sampleUv step, since it only depends on this pixel's depth.
		float depthDiff = abs(depth - uFocusDepth);
		float blurAmount = uFocusActive * smoothstep(uFocusRange, uFocusRange + uFocusFalloff, depthDiff);

		// uParallaxStrength scales how far the "camera" moves with the mouse;
		// uDepthStrength scales how much near/far pixels separate from each other.
		vec2 offset = uMouse * uParallaxStrength * uDepthStrength * edgeSoftening * (depth - 0.5);
		vec2 sampleUv = clamp(vUv + offset, 0.001, 0.999);

		// Real hardware mipmap-based DOF: textureLod reads a genuinely
		// pre-filtered mip level directly, rather than faking blur from a
		// handful of sharp taps. Three earlier attempts at manual tap
		// patterns each showed a different artifact (too small to see, a
		// sparse ring with a hole in the middle producing ghosting, and
		// sharp point-samples reading as distinct "bubbles") — sampling
		// actual pre-blurred image data sidesteps all three at once.
		float lod = blurAmount * uMaxBlurLod;
		vec3 color = textureLod(uImage, sampleUv, lod).rgb;

		// farAmount assumes higher depth = nearer (depth-anything convention);
		// flip to depth if the far background isn't the hazy side in practice.
		// Computed here (rather than down in the haze block below, where it
		// used to live) so lighting can also read it — see next comment.
		float farAmount = clamp(1.0 - depth, 0.0, 1.0);

		// A flat/neutral (mid-gray) lighting texture maps to exactly 1.0 here,
		// so a project that hasn't run depth yet — and thus has no lighting
		// derived — is a no-op. Sampled at vUv (not sampleUv) so the shading
		// stays fixed to the screen rather than swimming with the parallax.
		// uLightingStrength scales the ±8% swing around 1.0; strength 0 is a
		// true no-op (matches the neutral-texture case above), strength 1
		// reproduces the original fixed ±8%. Contrast is further tapered by
		// farAmount — near things get the full swing, far things fade toward
		// (not fully to) flat shading, echoing the same depth falloff haze
		// uses below so both effects reinforce the same "things recede" read
		// instead of just independently coexisting. The 0.35 floor keeps
		// distant areas from going completely shadeless.
		float lighting = texture2D(uLighting, vUv).r;
		float lightingRange = 0.08 * uLightingStrength * mix(1.0, 0.35, farAmount);
		color *= mix(1.0 - lightingRange, 1.0 + lightingRange, lighting);

		// Haze last, as the outermost "atmosphere in front of everything"
		// layer — applied after color sampling and DOF blur, using the same
		// depth variable so it automatically respects the invert toggle.
		color = mix(color, uHazeColor, farAmount * uHazeStrength);
		float hazeGray = dot(color, vec3(0.299, 0.587, 0.114));
		color = mix(color, vec3(hazeGray), farAmount * uHazeStrength * 0.5);

		fragColor = vec4(color, 1.0);
	}
`;
