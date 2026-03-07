"""
FinGuard AI — Pydantic Tool Schemas & Mock Implementations
Action Node tools for the LangGraph pipeline.
"""

from pydantic import BaseModel, Field
from datetime import date, timedelta
import random
import hashlib


# ─── Tool Schemas ────────────────────────────────────────────────────

class CreditRiskInput(BaseModel):
    """Input schema for credit risk calculation."""
    tc_id: str = Field(..., description="Turkish Citizen ID (TC Kimlik No)")
    amount: float = Field(..., gt=0, description="Requested credit amount in TRY")


class CreditRiskOutput(BaseModel):
    """Output schema for credit risk calculation."""
    simulated: bool
    disclaimer: str
    tc_id: str
    requested_amount: float
    risk_score: float
    risk_category: str
    monthly_payment: float
    interest_rate: float
    recommendation: str
    assessment_date: str


class LeaveEntitlementInput(BaseModel):
    """Input schema for leave entitlement check."""
    employee_id: str = Field(..., description="Employee ID within the organization")


class LeaveEntitlementOutput(BaseModel):
    """Output schema for leave entitlement check."""
    simulated: bool
    disclaimer: str
    employee_id: str
    employee_name: str
    total_annual_leave: int
    used_leave: int
    remaining_leave: int
    sick_leave_taken: int
    next_accrual_date: str
    employment_start_date: str
    years_of_service: int
    legal_minimum_leave: int
    notes: str


# ─── Mock Implementations ───────────────────────────────────────────

SIMULATION_DISCLAIMER = (
    "Simulated demo output. Not based on live customer, payroll, or bureau data."
)

def calculate_credit_risk(params: CreditRiskInput) -> CreditRiskOutput:
    """
    Simulates a credit risk assessment based on TC ID and amount.
    Uses deterministic seeding from the TC ID for consistent results.
    """
    seed = int(hashlib.sha256(params.tc_id.encode()).hexdigest()[:8], 16)
    rng = random.Random(seed)

    risk_score = round(rng.uniform(200, 850), 1)

    if risk_score >= 700:
        category = "LOW"
        rate = round(rng.uniform(1.29, 2.15), 2)
        recommendation = (
            "Applicant has a strong credit profile. "
            "Proceed with standard approval workflow."
        )
    elif risk_score >= 500:
        category = "MEDIUM"
        rate = round(rng.uniform(2.15, 3.49), 2)
        recommendation = (
            "Applicant presents moderate risk. "
            "Recommend additional collateral or a guarantor before approval."
        )
    else:
        category = "HIGH"
        rate = round(rng.uniform(3.49, 4.99), 2)
        recommendation = (
            "Applicant is flagged as high risk. "
            "Recommend denial or require substantial collateral and reduced limit."
        )

    monthly_rate = rate / 100
    term = 36
    monthly_payment = round(
        params.amount * (monthly_rate / (1 - (1 + monthly_rate) ** -term)), 2
    )

    return CreditRiskOutput(
        simulated=True,
        disclaimer=SIMULATION_DISCLAIMER,
        tc_id=params.tc_id,
        requested_amount=params.amount,
        risk_score=risk_score,
        risk_category=category,
        monthly_payment=monthly_payment,
        interest_rate=rate,
        recommendation=recommendation,
        assessment_date=date.today().isoformat(),
    )


def check_leave_entitlement(params: LeaveEntitlementInput) -> LeaveEntitlementOutput:
    """
    Simulates an HR leave entitlement lookup.
    Turkish Labor Law (İş Kanunu No. 4857, Article 53):
      - 1-5 years: 14 days
      - 5-15 years: 20 days
      - 15+ years: 26 days
    """
    seed = int(hashlib.sha256(params.employee_id.encode()).hexdigest()[:8], 16)
    rng = random.Random(seed)

    first_names = ["Ahmet", "Elif", "Mehmet", "Zeynep", "Emre", "Ayşe", "Burak", "Selin"]
    last_names = ["Yılmaz", "Kaya", "Demir", "Çelik", "Şahin", "Öztürk", "Arslan", "Koç"]
    name = f"{rng.choice(first_names)} {rng.choice(last_names)}"

    years_of_service = rng.randint(1, 25)

    # Turkish Labor Law Article 53
    if years_of_service <= 5:
        legal_min = 14
    elif years_of_service <= 15:
        legal_min = 20
    else:
        legal_min = 26

    total_leave = max(legal_min, legal_min + rng.randint(0, 5))
    used = rng.randint(0, total_leave)
    sick = rng.randint(0, 10)

    start_date = date.today() - timedelta(days=years_of_service * 365)
    next_accrual = date(date.today().year + 1, start_date.month, min(start_date.day, 28))

    if used >= total_leave:
        notes = (
            "⚠️ Employee has exhausted their annual leave. "
            "Any further leave requests require management approval under İş Kanunu Art. 56."
        )
    elif total_leave - used <= 3:
        notes = (
            "⚠️ Employee has very limited remaining leave. "
            "Consider coordinating with HR for year-end planning."
        )
    else:
        notes = "Employee leave balance is within normal parameters."

    return LeaveEntitlementOutput(
        simulated=True,
        disclaimer=SIMULATION_DISCLAIMER,
        employee_id=params.employee_id,
        employee_name=name,
        total_annual_leave=total_leave,
        used_leave=used,
        remaining_leave=total_leave - used,
        sick_leave_taken=sick,
        next_accrual_date=next_accrual.isoformat(),
        employment_start_date=start_date.isoformat(),
        years_of_service=years_of_service,
        legal_minimum_leave=legal_min,
        notes=notes,
    )


# ─── Tool Registry ──────────────────────────────────────────────────

TOOL_REGISTRY = {
    "calculate_credit_risk": {
        "function": calculate_credit_risk,
        "input_schema": CreditRiskInput,
        "description": (
            "Simulated demo credit risk estimate based on a Turkish citizen ID and requested "
            "credit amount. Does not use any live banking or bureau data."
        ),
    },
    "check_leave_entitlement": {
        "function": check_leave_entitlement,
        "input_schema": LeaveEntitlementInput,
        "description": (
            "Simulated demo leave-balance estimate according to Turkish Labor Law "
            "(İş Kanunu No. 4857, Article 53). Does not use a live HRIS or payroll system."
        ),
    },
}


def get_tools_description() -> str:
    """Generate a formatted tool description string for the LLM system prompt."""
    lines = []
    for name, info in TOOL_REGISTRY.items():
        schema = info["input_schema"]
        fields = []
        for field_name, field_info in schema.model_fields.items():
            fields.append(f"    - {field_name} ({field_info.annotation.__name__}): {field_info.description}")
        lines.append(f"- **{name}**: {info['description']}")
        lines.append("  Parameters:")
        lines.extend(fields)
    return "\n".join(lines)


def execute_tool(tool_name: str, arguments: dict) -> str:
    """Execute a registered tool by name with the given arguments."""
    if tool_name not in TOOL_REGISTRY:
        return f"Error: Unknown tool '{tool_name}'. Available tools: {list(TOOL_REGISTRY.keys())}"

    try:
        tool = TOOL_REGISTRY[tool_name]
        validated_input = tool["input_schema"](**arguments)
        result = tool["function"](validated_input)
        return result.model_dump_json(indent=2)
    except Exception as e:
        return f"Error executing tool '{tool_name}': {str(e)}"
