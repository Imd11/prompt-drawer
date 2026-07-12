use std::time::{Duration, Instant};

use super::{
    ax_attribute_is_settable, ax_bool_attribute, ax_children, ax_element_frame, ax_element_pid,
    ax_string_attribute, copy_ax_attribute, AXUIElementRef, AXUIElementSetMessagingTimeout,
    OwnedCf,
};

#[derive(Clone, Copy, Debug)]
pub(super) struct AxTraversalLimits {
    pub max_nodes: usize,
    pub max_depth: usize,
    pub max_elapsed: Duration,
    pub per_element_timeout: f32,
}

impl AxTraversalLimits {
    pub(super) fn diagnostic() -> Self {
        Self {
            max_nodes: 600,
            max_depth: 14,
            max_elapsed: Duration::from_millis(220),
            per_element_timeout: 0.02,
        }
    }
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub(super) struct AxTraversalStats {
    pub visited_nodes: usize,
    pub deepest_level: usize,
    pub stopped_by_budget: bool,
}

pub(super) struct AxTraversalBudget {
    limits: AxTraversalLimits,
    started: Instant,
    stats: AxTraversalStats,
}

impl AxTraversalBudget {
    pub(super) fn new(limits: AxTraversalLimits) -> Self {
        Self {
            limits,
            started: Instant::now(),
            stats: AxTraversalStats::default(),
        }
    }

    pub(super) fn try_visit(&mut self, depth: usize) -> bool {
        if self.stats.visited_nodes >= self.limits.max_nodes
            || depth > self.limits.max_depth
            || self.started.elapsed() >= self.limits.max_elapsed
        {
            self.stats.stopped_by_budget = true;
            return false;
        }

        self.stats.visited_nodes += 1;
        self.stats.deepest_level = self.stats.deepest_level.max(depth);
        true
    }

    #[cfg(test)]
    fn set_started(&mut self, started: Instant) {
        self.started = started;
    }

    pub(super) fn stats(&self) -> AxTraversalStats {
        self.stats
    }

    pub(super) fn has_time_remaining(&mut self) -> bool {
        if self.started.elapsed() < self.limits.max_elapsed {
            return true;
        }
        self.stats.stopped_by_budget = true;
        false
    }
}

fn apply_timeout(element: AXUIElementRef, timeout: f32) {
    unsafe {
        AXUIElementSetMessagingTimeout(element, timeout);
    }
}

pub(super) fn copy_attribute(
    element: AXUIElementRef,
    attribute: &str,
    timeout: f32,
) -> Option<OwnedCf> {
    apply_timeout(element, timeout);
    copy_ax_attribute(element, attribute)
}

pub(super) fn string_attribute(
    element: AXUIElementRef,
    attribute: &str,
    timeout: f32,
) -> Option<String> {
    apply_timeout(element, timeout);
    ax_string_attribute(element, attribute)
}

pub(super) fn bool_attribute(
    element: AXUIElementRef,
    attribute: &str,
    timeout: f32,
) -> Option<bool> {
    apply_timeout(element, timeout);
    ax_bool_attribute(element, attribute)
}

pub(super) fn attribute_is_settable(
    element: AXUIElementRef,
    attribute: &str,
    timeout: f32,
) -> bool {
    apply_timeout(element, timeout);
    ax_attribute_is_settable(element, attribute)
}

pub(super) fn children(element: AXUIElementRef, timeout: f32) -> Vec<OwnedCf> {
    apply_timeout(element, timeout);
    ax_children(element)
}

pub(super) fn frame(element: AXUIElementRef, timeout: f32) -> Option<super::CandidateInput> {
    apply_timeout(element, timeout);
    ax_element_frame(element)
}

pub(super) fn owner_pid(element: AXUIElementRef, timeout: f32) -> Option<u32> {
    apply_timeout(element, timeout);
    ax_element_pid(element)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn traversal_budget_stops_at_node_limit() {
        let mut budget = AxTraversalBudget::new(AxTraversalLimits {
            max_nodes: 2,
            max_depth: 10,
            max_elapsed: Duration::from_secs(1),
            per_element_timeout: 0.1,
        });

        assert!(budget.try_visit(1));
        assert!(budget.try_visit(2));
        assert!(!budget.try_visit(3));
        assert_eq!(budget.stats().visited_nodes, 2);
        assert!(budget.stats().stopped_by_budget);
    }

    #[test]
    fn traversal_budget_stops_at_depth_limit() {
        let mut budget = AxTraversalBudget::new(AxTraversalLimits {
            max_nodes: 10,
            max_depth: 2,
            max_elapsed: Duration::from_secs(1),
            per_element_timeout: 0.1,
        });

        assert!(budget.try_visit(2));
        assert!(!budget.try_visit(3));
        assert_eq!(budget.stats().deepest_level, 2);
    }

    #[test]
    fn traversal_budget_stops_at_elapsed_limit() {
        let mut budget = AxTraversalBudget::new(AxTraversalLimits {
            max_nodes: 10,
            max_depth: 10,
            max_elapsed: Duration::from_millis(1),
            per_element_timeout: 0.1,
        });
        budget.set_started(Instant::now() - Duration::from_millis(2));

        assert!(!budget.try_visit(1));
        assert_eq!(budget.stats().visited_nodes, 0);
        assert!(budget.stats().stopped_by_budget);
    }

    #[test]
    fn diagnostic_timeout_keeps_attribute_batches_inside_total_budget() {
        let limits = AxTraversalLimits::diagnostic();

        assert!(limits.per_element_timeout <= 0.025);
        assert!(limits.max_elapsed <= Duration::from_millis(250));
    }
}
