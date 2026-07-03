package extractors

import (
	"encoding/json"
	"fmt"
)

// noiseFields are top-level fields removed from every Azure SDK resource response.
// These carry no analytical value — they are internal Azure metadata.
var noiseFields = []string{
	"etag",
	"systemData",
	"type",
	"id",
}

// CleanResource marshals any Azure SDK struct to JSON, strips top-level noise
// fields, and returns clean JSON bytes ready to store in the database.
func CleanResource(resource any) ([]byte, error) {
	if resource == nil {
		return nil, fmt.Errorf("resource is nil")
	}

	raw, err := json.Marshal(resource)
	if err != nil {
		return nil, fmt.Errorf("marshal resource: %w", err)
	}

	var data map[string]any
	if err := json.Unmarshal(raw, &data); err != nil {
		return nil, fmt.Errorf("unmarshal to map: %w", err)
	}

	for _, field := range noiseFields {
		delete(data, field)
	}

	clean, err := json.Marshal(data)
	if err != nil {
		return nil, fmt.Errorf("marshal clean data: %w", err)
	}

	return clean, nil
}

// CleanResources applies CleanResource to a typed slice of Azure SDK structs
// and returns a slice of cleaned JSON objects.
func CleanResources[T any](resources []T) ([]json.RawMessage, error) {
	result := make([]json.RawMessage, 0, len(resources))
	for _, r := range resources {
		clean, err := CleanResource(r)
		if err != nil {
			return nil, err
		}
		result = append(result, json.RawMessage(clean))
	}
	return result, nil
}
