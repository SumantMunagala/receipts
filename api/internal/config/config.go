// Package config loads service configuration from the environment.
package config

import (
	"fmt"
	"strings"
)

// Config holds the API service configuration.
//
// Only the variables the service uses today are required. When a phase starts
// using another key from CLAUDE.md (DATABASE_URL, REDIS_URL, ...), add it to
// the struct and to the required list in Load.
type Config struct {
	ExternalsMode string // "live" or "mock"
	Port          string
}

// Load reads configuration via getenv and reports every missing or invalid
// required variable in a single error.
func Load(getenv func(string) string) (Config, error) {
	cfg := Config{
		ExternalsMode: getenv("EXTERNALS_MODE"),
		Port:          getenv("PORT"),
	}

	var missing []string
	for _, kv := range []struct{ key, val string }{
		{"EXTERNALS_MODE", cfg.ExternalsMode},
		{"PORT", cfg.Port},
	} {
		if kv.val == "" {
			missing = append(missing, kv.key)
		}
	}
	if len(missing) > 0 {
		return Config{}, fmt.Errorf("missing required env vars: %s", strings.Join(missing, ", "))
	}

	if cfg.ExternalsMode != "live" && cfg.ExternalsMode != "mock" {
		return Config{}, fmt.Errorf("invalid EXTERNALS_MODE %q: must be \"live\" or \"mock\"", cfg.ExternalsMode)
	}

	return cfg, nil
}

// CI test: deliberate type error. Must never be merged.
var _ int = "x"
