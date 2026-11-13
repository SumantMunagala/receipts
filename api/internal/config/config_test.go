package config

import (
	"strings"
	"testing"
)

func TestLoad(t *testing.T) {
	tests := []struct {
		name    string
		env     map[string]string
		wantErr string
	}{
		{
			name: "all required present",
			env:  map[string]string{"EXTERNALS_MODE": "mock", "PORT": "8080"},
		},
		{
			name:    "missing vars are all named",
			env:     map[string]string{},
			wantErr: "missing required env vars: EXTERNALS_MODE, PORT",
		},
		{
			name:    "missing one var",
			env:     map[string]string{"EXTERNALS_MODE": "live"},
			wantErr: "missing required env vars: PORT",
		},
		{
			name:    "invalid externals mode",
			env:     map[string]string{"EXTERNALS_MODE": "fake", "PORT": "8080"},
			wantErr: "invalid EXTERNALS_MODE",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			cfg, err := Load(func(k string) string { return tt.env[k] })
			if tt.wantErr == "" {
				if err != nil {
					t.Fatalf("unexpected error: %v", err)
				}
				if cfg.Port != tt.env["PORT"] || cfg.ExternalsMode != tt.env["EXTERNALS_MODE"] {
					t.Fatalf("config not populated: %+v", cfg)
				}
				return
			}
			if err == nil || !strings.Contains(err.Error(), tt.wantErr) {
				t.Fatalf("error = %v, want containing %q", err, tt.wantErr)
			}
		})
	}
}
