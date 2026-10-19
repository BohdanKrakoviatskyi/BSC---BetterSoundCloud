/// Stateful linear conversion from decoded stereo frames to the output device rate.
/// Phase and the previous frame carry over chunk boundaries to avoid discontinuities.
#[derive(Debug, Clone)]
pub struct RateConverter {
    step: f64,
    position: f64,
    previous: [f32; 2],
    primed: bool,
}

impl RateConverter {
    pub fn new(from_rate: u32, to_rate: u32) -> Self {
        Self {
            step: f64::from(from_rate.max(1)) / f64::from(to_rate.max(1)),
            position: 0.0,
            previous: [0.0; 2],
            primed: false,
        }
    }
    pub fn reset(&mut self) {
        self.position = 0.0;
        self.primed = false;
        self.previous = [0.0; 2];
    }
    pub fn process(&mut self, input: &[f32]) -> Vec<f32> {
        let frames = input.len() / 2;
        if frames == 0 {
            return Vec::new();
        }
        if self.step == 1.0 {
            return input[..frames * 2].to_vec();
        }
        let mut output = Vec::with_capacity((frames as f64 / self.step).ceil() as usize * 2 + 2);
        let mut index = 0;
        if !self.primed {
            self.previous = [input[0], input[1]];
            index = 1;
            self.primed = true;
        }
        while index < frames {
            let upcoming = [input[index * 2], input[index * 2 + 1]];
            while self.position < 1.0 {
                let fraction = self.position as f32;
                output.push(self.previous[0] + (upcoming[0] - self.previous[0]) * fraction);
                output.push(self.previous[1] + (upcoming[1] - self.previous[1]) * fraction);
                self.position += self.step;
            }
            self.position -= 1.0;
            self.previous = upcoming;
            index += 1;
        }
        output
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::f64::consts::TAU;
    fn tone(start: usize, count: usize) -> Vec<f32> {
        (start..start + count)
            .flat_map(|i| {
                let s = (TAU * 1000.0 * i as f64 / 44100.0).sin() as f32;
                [s, -s]
            })
            .collect()
    }
    #[test]
    fn conversion_carries_phase_across_irregular_chunks() {
        let mut converter = RateConverter::new(44_100, 48_000);
        let mut output = Vec::new();
        let mut input_index = 0;
        for count in [1024, 576, 128, 1, 2, 1024, 333, 777] {
            output.extend(converter.process(&tone(input_index, count)));
            input_index += count;
        }
        let frames = output.len() / 2;
        let expected = input_index as f64 * 48_000.0 / 44_100.0;
        assert!((frames as f64 - expected).abs() < 3.0);
        let max = output
            .as_chunks::<2>()
            .0
            .iter()
            .enumerate()
            .map(|(i, p)| {
                let target = (TAU * 1000.0 * i as f64 / 48_000.0).sin() as f32;
                (p[0] - target).abs().max((p[1] + target).abs())
            })
            .fold(0.0, f32::max);
        assert!(max < 0.006, "interpolation error {max}");
    }
    #[test]
    fn reset_does_not_leak_previous_track_samples() {
        let mut converter = RateConverter::new(44_100, 48_000);
        let _ = converter.process(&[0.5; 2048]);
        converter.reset();
        let output = converter.process(&[-0.25; 2048]);
        assert!(output.iter().all(|x| (*x + 0.25).abs() < 1e-6));
    }
}
