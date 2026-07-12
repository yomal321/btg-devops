package extractors

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/Azure/azure-sdk-for-go/sdk/azcore"
	"github.com/Azure/azure-sdk-for-go/sdk/resourcemanager/cdn/armcdn"
)

// CDNData holds clean extracted data for all CDN/Azure Front Door profiles —
// closes the "no per-profile routing/WAF config" data gap (spec 11 round 2
// §2): the inventory scope only sees profile/endpoint/policy ENVELOPES
// (name, type, tags), not their actual routing or WAF attachment.
type CDNData struct {
	TotalProfiles int               `json:"total_profiles"`
	Profiles      []json.RawMessage `json:"profiles"`
}

// maxRoutesPerEndpoint caps how many routes are stored per endpoint.
const maxRoutesPerEndpoint = 20

type cdnEndpointEntry struct {
	Name         string     `json:"name"`
	HostName     string     `json:"host_name,omitempty"`
	EnabledState string     `json:"enabled_state,omitempty"`
	Routes       []cdnRoute `json:"routes"`
	RoutesError  string     `json:"routes_error,omitempty"`
}

type cdnRoute struct {
	Name               string   `json:"name"`
	CustomDomains      []string `json:"custom_domains"`
	ForwardingProtocol string   `json:"forwarding_protocol,omitempty"`
	HTTPSRedirect      string   `json:"https_redirect,omitempty"`
	EnabledState       string   `json:"enabled_state,omitempty"`
}

type cdnSecurityPolicyEntry struct {
	Name              string `json:"name"`
	WafPolicyID       string `json:"waf_policy_id,omitempty"`
	AssociatedDomains int    `json:"associated_domains"`
}

// ExtractCDN fetches all CDN/Front Door profiles and enriches each with its
// AFD endpoints (+ routes) and security policies (WAF attachment).
func ExtractCDN(ctx context.Context, subID string, cred azcore.TokenCredential) (*CDNData, error) {
	profilesClient, err := armcdn.NewProfilesClient(subID, cred, nil)
	if err != nil {
		return nil, fmt.Errorf("creating cdn profiles client: %w", err)
	}
	endpointsClient, err := armcdn.NewAFDEndpointsClient(subID, cred, nil)
	if err != nil {
		return nil, fmt.Errorf("creating afd endpoints client: %w", err)
	}
	routesClient, err := armcdn.NewRoutesClient(subID, cred, nil)
	if err != nil {
		return nil, fmt.Errorf("creating routes client: %w", err)
	}
	securityPoliciesClient, err := armcdn.NewSecurityPoliciesClient(subID, cred, nil)
	if err != nil {
		return nil, fmt.Errorf("creating security policies client: %w", err)
	}

	var profiles []*armcdn.Profile
	pager := profilesClient.NewListPager(nil)
	for pager.More() {
		page, err := pager.NextPage(ctx)
		if err != nil {
			return nil, fmt.Errorf("listing cdn profiles: %w", err)
		}
		profiles = append(profiles, page.Value...)
	}

	cleanProfiles := make([]json.RawMessage, 0, len(profiles))
	for _, profile := range profiles {
		clean, err := CleanResource(profile)
		if err != nil {
			return nil, fmt.Errorf("cleaning cdn profile %s: %w", derefStr(profile.Name), err)
		}

		extra := map[string]any{}
		if profile.ID != nil && profile.Name != nil {
			rg := extractResourceGroup(*profile.ID)
			name := *profile.Name

			endpoints, epErr := listCDNEndpoints(ctx, endpointsClient, routesClient, rg, name)
			if epErr != nil {
				extra["endpoints_error"] = epErr.Error()
			} else {
				extra["endpoints"] = endpoints
			}

			policies, spErr := listCDNSecurityPolicies(ctx, securityPoliciesClient, rg, name)
			if spErr != nil {
				extra["security_policies_error"] = spErr.Error()
			} else {
				extra["security_policies"] = policies
			}
		}

		enriched, err := mergeIntoJSON(clean, extra)
		if err != nil {
			return nil, fmt.Errorf("enriching cdn profile %s: %w", derefStr(profile.Name), err)
		}
		cleanProfiles = append(cleanProfiles, enriched)
	}

	return &CDNData{
		TotalProfiles: len(profiles),
		Profiles:      cleanProfiles,
	}, nil
}

func listCDNEndpoints(ctx context.Context, endpointsClient *armcdn.AFDEndpointsClient, routesClient *armcdn.RoutesClient, rg, profileName string) ([]cdnEndpointEntry, error) {
	var out []cdnEndpointEntry
	pager := endpointsClient.NewListByProfilePager(rg, profileName, nil)
	for pager.More() {
		page, err := pager.NextPage(ctx)
		if err != nil {
			return nil, fmt.Errorf("listing afd endpoints: %w", err)
		}
		for _, ep := range page.Value {
			if ep == nil || ep.Name == nil {
				continue
			}
			entry := cdnEndpointEntry{Name: *ep.Name}
			if p := ep.Properties; p != nil {
				if p.HostName != nil {
					entry.HostName = *p.HostName
				}
				if p.EnabledState != nil {
					entry.EnabledState = string(*p.EnabledState)
				}
			}
			routes, err := listCDNRoutes(ctx, routesClient, rg, profileName, *ep.Name)
			if err != nil {
				entry.RoutesError = err.Error()
			} else {
				entry.Routes = routes
			}
			out = append(out, entry)
		}
	}
	return out, nil
}

func listCDNRoutes(ctx context.Context, client *armcdn.RoutesClient, rg, profileName, endpointName string) ([]cdnRoute, error) {
	var out []cdnRoute
	pager := client.NewListByEndpointPager(rg, profileName, endpointName, nil)
	for pager.More() {
		page, err := pager.NextPage(ctx)
		if err != nil {
			return nil, fmt.Errorf("listing routes for endpoint %s: %w", endpointName, err)
		}
		for _, r := range page.Value {
			if r == nil || r.Name == nil {
				continue
			}
			route := cdnRoute{Name: *r.Name}
			if p := r.Properties; p != nil {
				for _, d := range p.CustomDomains {
					if d != nil && d.ID != nil {
						route.CustomDomains = append(route.CustomDomains, *d.ID)
					}
				}
				if p.ForwardingProtocol != nil {
					route.ForwardingProtocol = string(*p.ForwardingProtocol)
				}
				if p.HTTPSRedirect != nil {
					route.HTTPSRedirect = string(*p.HTTPSRedirect)
				}
				if p.EnabledState != nil {
					route.EnabledState = string(*p.EnabledState)
				}
			}
			out = append(out, route)
			if len(out) >= maxRoutesPerEndpoint {
				return out, nil
			}
		}
	}
	return out, nil
}

func listCDNSecurityPolicies(ctx context.Context, client *armcdn.SecurityPoliciesClient, rg, profileName string) ([]cdnSecurityPolicyEntry, error) {
	var out []cdnSecurityPolicyEntry
	pager := client.NewListByProfilePager(rg, profileName, nil)
	for pager.More() {
		page, err := pager.NextPage(ctx)
		if err != nil {
			return nil, fmt.Errorf("listing security policies: %w", err)
		}
		for _, sp := range page.Value {
			if sp == nil || sp.Name == nil {
				continue
			}
			entry := cdnSecurityPolicyEntry{Name: *sp.Name}
			if p := sp.Properties; p != nil {
				if wafParams, ok := p.Parameters.(*armcdn.SecurityPolicyWebApplicationFirewallParameters); ok && wafParams != nil {
					if wafParams.WafPolicy != nil && wafParams.WafPolicy.ID != nil {
						entry.WafPolicyID = *wafParams.WafPolicy.ID
					}
					for _, assoc := range wafParams.Associations {
						if assoc != nil {
							entry.AssociatedDomains += len(assoc.Domains)
						}
					}
				}
			}
			out = append(out, entry)
		}
	}
	return out, nil
}
