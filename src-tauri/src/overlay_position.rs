use crate::platform::CandidateInput;

#[derive(Clone, Debug)]
pub struct OverlayPoint {
    pub x: f64,
    pub y: f64,
}

/// Calculate button position using fixed safe offset
/// x = input.x + 48
/// y = input.y + input.height - 32
pub fn prompt_button_position(input: &CandidateInput) -> OverlayPoint {
    OverlayPoint {
        x: input.x + 48.0,
        y: input.y + input.height - 32.0,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::platform::CandidateInput;

    #[test]
    fn test_button_x_offset() {
        let input = CandidateInput { x: 100.0, y: 100.0, width: 300.0, height: 200.0 };
        let pos = prompt_button_position(&input);
        assert_eq!(pos.x, 148.0);
    }

    #[test]
    fn test_button_y_at_bottom_of_input() {
        let input = CandidateInput { x: 100.0, y: 100.0, width: 300.0, height: 200.0 };
        let pos = prompt_button_position(&input);
        assert_eq!(pos.y, 268.0); // 100 + 200 - 32
    }
}